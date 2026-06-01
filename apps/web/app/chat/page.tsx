"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, Cite, Field, Select, Textarea } from "@expertos/ui";
import type { ChatCitationDto } from "@expertos/shared";
import { useAuth } from "../../src/lib/auth-context";
import {
  fetchExperts,
  renditionLabel,
  streamChat,
  type ExpertVoice,
} from "../../src/lib/chat-client";

interface UiMessage {
  role: "user" | "assistant";
  content: string;
  citations: ChatCitationDto[];
  /** False while the assistant message is still streaming. */
  done: boolean;
  /** Display name when the answer is rendered in an expert's voice. */
  expertName?: string;
}

/** Replaces the last message in the list via `fn` (immutably). */
function updateLast(messages: UiMessage[], fn: (m: UiMessage) => UiMessage): UiMessage[] {
  if (messages.length === 0) return messages;
  const copy = messages.slice();
  copy[copy.length - 1] = fn(copy[copy.length - 1]);
  return copy;
}

/** Single `[n]` citation marker in answer prose. */
const MARKER = /\[(\d+)\]/g;

/**
 * Renders an assistant answer with its `[n]` markers turned into clickable `.cite` chips — but
 * only once the stream has completed and the marker resolves to a real citation (M4.2
 * render-after-resolve: a marker is never a live `.cite` mid-stream or when it points nowhere).
 * Clicking a marker invokes `onCite` for click-to-passage. An unresolvable bracketed number is
 * left as plain text so a hallucinated `[9]` can never masquerade as a verified source.
 */
function renderAnswer(
  content: string,
  byOrdinal: Map<number, ChatCitationDto>,
  onCite: (ordinal: number) => void,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const match of content.matchAll(MARKER)) {
    const start = match.index ?? 0;
    const ordinal = Number(match[1]);
    const citation = byOrdinal.get(ordinal);
    if (start > cursor) nodes.push(content.slice(cursor, start));
    if (citation) {
      nodes.push(
        <Cite
          key={`cite-${key++}`}
          label={ordinal}
          resolved
          variant={citation.kind}
          role="button"
          tabIndex={0}
          aria-label={`Source ${ordinal}`}
          onClick={() => onCite(ordinal)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onCite(ordinal);
            }
          }}
        />,
      );
    } else {
      nodes.push(match[0]);
    }
    cursor = start + match[0].length;
  }
  if (cursor < content.length) nodes.push(content.slice(cursor));
  return nodes;
}

/**
 * One assistant turn: the answer prose with inline citation markers plus a sources drawer
 * (M4.2). The drawer lists each resolved source with its quote and `document_version_id`
 * provenance; clicking an inline marker (or the answer's `.cite`) highlights and scrolls to the
 * matching source row (click-to-passage). Markers are only interactive after the stream finishes.
 */
function AssistantAnswer({ message }: { message: UiMessage }) {
  const [activeOrdinal, setActiveOrdinal] = useState<number | null>(null);
  const rowRefs = useRef(new Map<number, HTMLDivElement>());

  const byOrdinal = useMemo(() => {
    const map = new Map<number, ChatCitationDto>();
    for (const citation of message.citations) map.set(citation.ordinal, citation);
    return map;
  }, [message.citations]);

  const focusSource = useCallback((ordinal: number) => {
    setActiveOrdinal(ordinal);
    rowRefs.current.get(ordinal)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  const resolved = message.done && message.citations.length > 0;

  return (
    <>
      <p>
        {message.content
          ? resolved
            ? renderAnswer(message.content, byOrdinal, focusSource)
            : message.content
          : message.done
            ? ""
            : "…"}
      </p>
      {resolved && (
        <div className="sources">
          <span className="label">Sources</span>
          {message.citations.map((citation) => (
            <div
              key={citation.ordinal}
              ref={(el) => {
                if (el) rowRefs.current.set(citation.ordinal, el);
              }}
              className={citation.ordinal === activeOrdinal ? "source active" : "source"}
            >
              <Cite label={citation.ordinal} resolved variant={citation.kind} />
              <div className="source-body">
                {citation.quote && <span className="source-quote">{citation.quote}</span>}
                <span className="source-prov">
                  source:{" "}
                  {citation.kind === "upload"
                    ? (citation.sourceLabel ?? "uploaded file")
                    : citation.documentVersionId}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
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
              updateLast(prev, (m) => ({ ...m, citations: event.citations, done: true })),
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
          </Card>
        ))}
      </div>

      {error && <Badge tone="red">{error}</Badge>}

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
