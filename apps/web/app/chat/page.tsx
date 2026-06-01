"use client";

import { useCallback, useEffect, useState } from "react";
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
            <p>{m.content || (m.done ? "" : "…")}</p>
            {m.done && m.citations.length > 0 && (
              <div>
                <strong>Sources</strong>
                {m.citations.map((c) => (
                  <div key={c.ordinal}>
                    <Cite label={c.ordinal} resolved variant="knowledge" />
                    <span>{c.quote}</span>
                  </div>
                ))}
              </div>
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
