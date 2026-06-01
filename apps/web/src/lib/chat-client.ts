import type { ChatStreamEvent } from "@expertos/shared";

/** A selectable expert voice for the picker (mirrors the API's `ExpertVoiceMeta`). */
export interface ExpertVoice {
  expertId: string;
  displayName: string;
  languages: ("en" | "vi")[];
}

/**
 * The visible "AI rendition of [Expert]" disclosure (M2.2). Mirrors `buildAttribution` in
 * `@expertos/ai`, which is the canonical source — kept as a one-liner here because that package
 * is CommonJS and importing it would pull the whole module (incl. eval harnesses) into the
 * client bundle. Consolidate against the canonical helper if the API ever returns the label.
 */
export function renditionLabel(expertName: string): string {
  return `AI rendition of ${expertName}`;
}

/**
 * Base URL of the API. Defaults to the local dev port; production passes `NEXT_PUBLIC_API_URL`
 * as a build arg (the value is public — it only identifies the endpoint).
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** The fields the chat UI sends; the API applies defaults + validation (`chatRequestSchema`). */
interface ChatRequestBody {
  text: string;
  conversationId?: string;
  expertId?: string;
  language?: "en" | "vi";
}

/**
 * POSTs a chat turn and invokes `onEvent` for each Server-Sent-Events frame as it arrives.
 * Parses the `data:`-prefixed frames off the streamed body so the caller renders `delta` text
 * live and the resolved citations only on the terminal `done` frame (Open Decision #7).
 */
export async function streamChat(
  body: ChatRequestBody,
  token: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`chat request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 2);
      if (frame.startsWith("data:")) {
        const payload = frame.slice("data:".length).trim();
        if (payload) {
          onEvent(JSON.parse(payload) as ChatStreamEvent);
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

/** Fetches the selectable expert voices for the picker (only published, active voices). */
export async function fetchExperts(token: string): Promise<ExpertVoice[]> {
  const res = await fetch(`${API_URL}/experts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`experts request failed (${res.status})`);
  }
  return (await res.json()) as ExpertVoice[];
}
