"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Field, Input, Select, Textarea } from "@expertos/ui";
import type {
  ChatCitationDto,
  ConsultationRecommendationDto,
  UploadedFileDto,
  UploadMode,
} from "@expertos/shared";
import { useAuth } from "../../src/lib/auth-context";
import { AnswerView } from "../../src/components/answer-view";
import {
  fetchExperts,
  renditionLabel,
  respondToRecommendation,
  streamChat,
  submitFeedback,
  type ExpertVoice,
} from "../../src/lib/chat-client";
import { createSavedAnswer } from "../../src/lib/history-client";
import { uploadFile, UPLOAD_ACCEPT } from "../../src/lib/upload-client";

interface UiMessage {
  role: "user" | "assistant";
  content: string;
  citations: ChatCitationDto[];
  /** False while the assistant message is still streaming. */
  done: boolean;
  /** Persisted message id (assistant turns, set on the `done` frame) — the feedback target (M3.4). */
  messageId?: string;
  /** Display name when the answer is rendered in an expert's voice. */
  expertName?: string;
  /** True when no grounding sources were retrieved (M3.4) — surface a graceful next step. */
  insufficientKnowledge?: boolean;
  /** True when the answer was served by the cheaper fair-use model (M6.3) — a subtle note. */
  degraded?: boolean;
  /** In-chat consultation recommendation (M7.2), present only when a funnel rule fired. */
  recommendation?: ConsultationRecommendationDto | null;
}

/** Replaces the last message in the list via `fn` (immutably). */
function updateLast(messages: UiMessage[], fn: (m: UiMessage) => UiMessage): UiMessage[] {
  if (messages.length === 0) return messages;
  const copy = messages.slice();
  copy[copy.length - 1] = fn(copy[copy.length - 1]);
  return copy;
}

/**
 * The in-chat consultation recommendation (M7.2): a Book / Maybe later / Ask another prompt shown
 * under an answer when a funnel rule fired (M7.1). Book records the choice and opens the TidyCal
 * link in a new tab (a generic confirmation when no link is configured yet); the other two dismiss
 * the prompt — all three are recorded against the recommendation id for funnel attribution (M10.2).
 */
function ConsultationPrompt({ recommendation }: { recommendation: ConsultationRecommendationDto }) {
  const { getIdToken } = useAuth();
  const [status, setStatus] = useState<"open" | "busy" | "booked" | "dismissed">("open");
  const [error, setError] = useState<string | null>(null);

  const respond = useCallback(
    async (choice: "book" | "maybe_later" | "ask_another") => {
      setStatus("busy");
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError("Please sign in to continue.");
          setStatus("open");
          return;
        }
        const result = await respondToRecommendation(recommendation.id, choice, token);
        if (choice === "book") {
          if (result.booking?.tidycalLink) {
            window.open(result.booking.tidycalLink, "_blank", "noopener,noreferrer");
          }
          setStatus("booked");
        } else {
          setStatus("dismissed");
        }
      } catch {
        setError("Couldn't record that — please try again.");
        setStatus("open");
      }
    },
    [getIdToken, recommendation.id],
  );

  if (status === "dismissed") return null;

  if (status === "booked") {
    const link = recommendation.consultationType?.tidycalLink;
    return (
      <Badge tone="green">
        {link
          ? "We've opened your booking page in a new tab."
          : "Thanks — we'll be in touch to schedule your consultation."}
      </Badge>
    );
  }

  const busy = status === "busy";
  return (
    <Card className="card-pad">
      <Badge tone="amber">Consultation</Badge>
      <p>{recommendation.reason}</p>
      <Button variant="primary" onClick={() => void respond("book")} disabled={busy}>
        {recommendation.consultationType
          ? `Book ${recommendation.consultationType.name}`
          : "Book a consultation"}
      </Button>
      <Button variant="ghost" onClick={() => void respond("maybe_later")} disabled={busy}>
        Maybe later
      </Button>
      <Button variant="ghost" onClick={() => void respond("ask_another")} disabled={busy}>
        Ask another
      </Button>
      {error && <Badge tone="red">{error}</Badge>}
    </Card>
  );
}

/**
 * 👍/👎 feedback on a finished assistant answer (M3.4). The verdict is an idempotent upsert keyed
 * on the answer, so the user can flip 👍↔👎 or add/revise a reason; submitting reuses the same
 * endpoint. The reason field appears once a verdict is chosen — optional, length-bounded to mirror
 * the API's 500-char limit (directive §1.1). Ownership is enforced server-side by RLS.
 */
function AnswerFeedback({ messageId }: { messageId: string }) {
  const { getIdToken } = useAuth();
  const [verdict, setVerdict] = useState<boolean | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (helpful: boolean, withReason: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError("Please sign in to leave feedback.");
          return;
        }
        const trimmed = reason.trim();
        await submitFeedback(messageId, helpful, token, withReason && trimmed ? trimmed : undefined);
        setVerdict(helpful);
      } catch {
        setError("Couldn't save your feedback — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [getIdToken, messageId, reason],
  );

  return (
    <div className="row gap2 wrap">
      <span className="label">Was this helpful?</span>
      <Button
        variant={verdict === true ? "primary" : "subtle"}
        size="sm"
        onClick={() => void send(true, true)}
        disabled={busy}
        aria-pressed={verdict === true}
        aria-label="Helpful"
      >
        Yes
      </Button>
      <Button
        variant={verdict === false ? "dark" : "subtle"}
        size="sm"
        onClick={() => void send(false, true)}
        disabled={busy}
        aria-pressed={verdict === false}
        aria-label="Not helpful"
      >
        No
      </Button>
      {verdict !== null && (
        <>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            maxLength={500}
            placeholder="Add a reason (optional)"
            aria-label="Feedback reason"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void send(verdict, true)}
            disabled={busy || !reason.trim()}
          >
            Send reason
          </Button>
          <span className="muted">Thanks for your feedback.</span>
        </>
      )}
      {error && <Badge tone="red">{error}</Badge>}
    </div>
  );
}

/**
 * One assistant turn in the live chat: delegates to the shared {@link AnswerView} (M4.2 sources
 * drawer + render-after-resolve) once any prose has arrived, showing a streaming placeholder until
 * then. Markers stay non-interactive mid-stream (`interactive={message.done}`).
 */
function AssistantAnswer({ message }: { message: UiMessage }) {
  if (!message.content) {
    return <p>{message.done ? "" : "…"}</p>;
  }
  return (
    <AnswerView
      content={message.content}
      citations={message.citations}
      interactive={message.done}
    />
  );
}

/**
 * Bookmark a finished assistant answer (M3.2). Sends only the `messageId`; the owning conversation
 * is derived + ownership re-checked server-side. A 409 (already saved) is surfaced as a benign
 * "Saved" state rather than an error, so the toggle is idempotent from the user's view.
 */
function SaveAnswer({ messageId }: { messageId: string }) {
  const { getIdToken } = useAuth();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError("Please sign in to save answers.");
        return;
      }
      await createSavedAnswer(token, messageId);
      setSaved(true);
    } catch {
      setError("Couldn't save — please try again.");
    } finally {
      setBusy(false);
    }
  }, [getIdToken, messageId]);

  if (saved) return <Badge tone="green">Saved</Badge>;
  return (
    <>
      <Button variant="subtle" size="sm" onClick={() => void save()} disabled={busy}>
        Save answer
      </Button>
      {error && <Badge tone="red">{error}</Badge>}
    </>
  );
}

/** Human-readable file size for the uploaded-file list (binary units, matching the API's limit). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}

/**
 * Query-time document upload (M5, PRD §"Document-assisted Q&A"). The user picks a file and a
 * retention mode, then uploads it to the API (`POST /uploads`) which validates type/size, scans for
 * malware, parses+chunks+embeds, and stores it. A `persistent` file is indexed into the user's
 * private knowledge so any later question can retrieve it; a `temporary` file is scoped to the
 * current conversation and expires — so it is only retrievable once the chat has a conversation
 * (i.e. after the first message), which is surfaced as a hint. The server is the authority on
 * type/safety; a rejected upload shows the API's message verbatim. `chunkCount === 0` means the
 * file was stored but a parser for its format has not landed yet (PDF/DOCX), so it isn't searchable.
 */
function UploadPanel({ conversationId }: { conversationId: string | undefined }) {
  const { getIdToken } = useAuth();
  const [mode, setMode] = useState<UploadMode>("temporary");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<UploadedFileDto[]>([]);
  // Bumped after each upload to reset the native file input (it has no controlled value).
  const [inputKey, setInputKey] = useState(0);

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError("Please sign in to upload a document.");
          return;
        }
        const uploaded = await uploadFile(token, file, mode, conversationId);
        setFiles((prev) => [uploaded, ...prev]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed.");
      } finally {
        setBusy(false);
        setInputKey((k) => k + 1);
      }
    },
    [getIdToken, mode, conversationId],
  );

  return (
    <Card className="card-pad">
      <Badge tone="info">Documents</Badge>
      <p className="muted">
        Add a document for this chat. Persistent files are saved to your private knowledge and used
        in future questions; temporary files apply to this conversation only and expire.
      </p>
      <Field label="Mode" htmlFor="upload-mode">
        <Select
          id="upload-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as UploadMode)}
          disabled={busy}
        >
          <option value="temporary">Temporary (this conversation)</option>
          <option value="persistent">Persistent (saved to my knowledge)</option>
        </Select>
      </Field>
      <input
        key={inputKey}
        type="file"
        accept={UPLOAD_ACCEPT}
        disabled={busy}
        aria-label="Choose a document to upload"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {busy && <span className="muted">Uploading…</span>}
      {mode === "temporary" && !conversationId && (
        <span className="muted">
          Send a message first — temporary files attach to this conversation.
        </span>
      )}
      {error && <Badge tone="red">{error}</Badge>}
      {files.length > 0 && (
        <div className="col gap1">
          {files.map((f) => (
            <div key={f.id} className="row gap2 wrap">
              <span>{f.filename}</span>
              <Badge tone={f.mode === "persistent" ? "green" : "info"}>{f.mode}</Badge>
              <span className="muted">{formatBytes(f.sizeBytes)}</span>
              {f.chunkCount > 0 ? (
                <Badge tone="green">{f.chunkCount} searchable chunks</Badge>
              ) : (
                <Badge tone="amber">stored — not searchable yet</Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function ChatPage() {
  const { user, getIdToken } = useAuth();
  const [experts, setExperts] = useState<ExpertVoice[]>([]);
  const [expertId, setExpertId] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    void (async () => {
      try {
        const token = await getIdToken();
        if (!token) return;
        const list = await fetchExperts(token);
        if (active) setExperts(list);
      } catch {
        // The voice picker is optional — a failure here just leaves the neutral voice.
      }
    })();
    return () => {
      active = false;
    };
  }, [user, getIdToken]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setError(null);

    const token = await getIdToken();
    if (!token) {
      setError("Please sign in to chat.");
      return;
    }

    const expert = experts.find((e) => e.expertId === expertId);
    setDraft("");
    setBusy(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text, citations: [], done: true },
      {
        role: "assistant",
        content: "",
        citations: [],
        done: false,
        expertName: expert?.displayName,
      },
    ]);

    try {
      await streamChat(
        { text, conversationId, expertId: expertId || undefined, language: "en" },
        token,
        (event) => {
          if (event.type === "delta") {
            setMessages((prev) =>
              updateLast(prev, (m) => ({ ...m, content: m.content + event.text })),
            );
          } else if (event.type === "done") {
            setConversationId(event.conversationId);
            setMessages((prev) =>
              updateLast(prev, (m) => ({
                ...m,
                citations: event.citations,
                done: true,
                messageId: event.messageId,
                insufficientKnowledge: event.insufficientKnowledge,
                degraded: event.degraded ?? false,
                recommendation: event.recommendation ?? null,
              })),
            );
          } else {
            setError(event.message);
            setMessages((prev) => updateLast(prev, (m) => ({ ...m, done: true })));
          }
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed.");
      setMessages((prev) => updateLast(prev, (m) => ({ ...m, done: true })));
    } finally {
      setBusy(false);
    }
  }, [draft, busy, getIdToken, experts, expertId, conversationId]);

  if (!user) {
    return (
      <main className="card card-pad">
        <h1>Chat</h1>
        <Badge tone="info">Please sign in on the home page to start chatting.</Badge>
      </main>
    );
  }

  return (
    <main className="card card-pad">
      <h1>Chat</h1>

      <Field label="Expert voice" htmlFor="expert">
        <Select
          id="expert"
          value={expertId}
          onChange={(e) => setExpertId(e.target.value)}
          disabled={busy}
        >
          <option value="">Neutral (no expert voice)</option>
          {experts.map((e) => (
            <option key={e.expertId} value={e.expertId}>
              {e.displayName}
            </option>
          ))}
        </Select>
      </Field>

      <div>
        {messages.map((m, i) => (
          <Card key={i} className="card-pad">
            <Badge tone={m.role === "user" ? "info" : "green"}>
              {m.role === "user" ? "You" : "Assistant"}
            </Badge>
            {m.role === "assistant" && m.expertName && (
              <Badge tone="amber">{renditionLabel(m.expertName)}</Badge>
            )}
            {m.role === "assistant" ? (
              <AssistantAnswer message={m} />
            ) : (
              <p>{m.content}</p>
            )}
            {m.role === "assistant" && m.done && m.degraded && (
              <Badge tone="info">
                Fair-use mode — answered with a lighter model while you’re over this period’s soft
                limit.
              </Badge>
            )}
            {m.role === "assistant" && m.done && m.insufficientKnowledge && (
              <Card className="card-pad">
                <Badge tone="amber">Limited knowledge</Badge>
                <p>
                  I couldn’t find enough in the expert’s knowledge base to answer this confidently.
                  Try rephrasing your question, or book a consultation for a direct answer.
                </p>
              </Card>
            )}
            {m.role === "assistant" && m.done && m.recommendation && (
              <ConsultationPrompt recommendation={m.recommendation} />
            )}
            {m.role === "assistant" && m.done && m.messageId && (
              <>
                <AnswerFeedback messageId={m.messageId} />
                <div className="row gap2 wrap">
                  <SaveAnswer messageId={m.messageId} />
                </div>
              </>
            )}
          </Card>
        ))}
      </div>

      {error && <Badge tone="red">{error}</Badge>}

      <UploadPanel conversationId={conversationId} />

      <Field label="Your question" htmlFor="draft">
        <Textarea
          id="draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
          rows={3}
          placeholder="Ask a question…"
        />
      </Field>
      <Button variant="primary" onClick={() => void send()} disabled={busy || !draft.trim()}>
        {busy ? "Answering…" : "Send"}
      </Button>
    </main>
  );
}
