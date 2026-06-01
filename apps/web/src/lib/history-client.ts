import type {
  ConversationDetailDto,
  ConversationSearchResultDto,
  ConversationSummaryDto,
  SavedAnswerDto,
} from "@expertos/shared";

/**
 * Base URL of the API. Defaults to the local dev port; production passes `NEXT_PUBLIC_API_URL`
 * as a build arg (the value is public — it only identifies the endpoint). Mirrors `chat-client.ts`.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Page window for the paginated list endpoints (server clamps + defaults — `*ListQuerySchema`). */
interface Page {
  limit: number;
  offset: number;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

/**
 * The acting user's conversation history, most-recent-activity first (`GET /conversations`, M3.2).
 * Ownership is enforced server-side by RLS, so the list only ever contains the caller's own chats.
 */
export async function listConversations(
  token: string,
  page: Page,
): Promise<ConversationSummaryDto[]> {
  const res = await fetch(
    `${API_URL}/conversations?limit=${page.limit}&offset=${page.offset}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) {
    throw new Error(`conversations request failed (${res.status})`);
  }
  return (await res.json()) as ConversationSummaryDto[];
}

/** One conversation with its full transcript (`GET /conversations/:id`, M3.2). */
export async function getConversation(
  token: string,
  id: string,
): Promise<ConversationDetailDto> {
  const res = await fetch(`${API_URL}/conversations/${id}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(`conversation request failed (${res.status})`);
  }
  return (await res.json()) as ConversationDetailDto;
}

/**
 * Full-text search across the acting user's conversations (`GET /conversations/search`, M3.3). The
 * snippet wraps matched terms in guillemets (`«match»`), not HTML, so rendering it as text is safe
 * (directive §1). `q` is sent raw; the server trims, length-bounds, and NFC-normalizes it.
 */
export async function searchConversations(
  token: string,
  q: string,
  page: Page,
): Promise<ConversationSearchResultDto[]> {
  const res = await fetch(
    `${API_URL}/conversations/search?q=${encodeURIComponent(q)}&limit=${page.limit}&offset=${page.offset}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) {
    throw new Error(`search request failed (${res.status})`);
  }
  return (await res.json()) as ConversationSearchResultDto[];
}

/** Rename a conversation, overriding its auto-derived title (`PATCH /conversations/:id`, M3.2). */
export async function renameConversation(
  token: string,
  id: string,
  title: string,
): Promise<ConversationSummaryDto> {
  const res = await fetch(`${API_URL}/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    throw new Error(`rename failed (${res.status})`);
  }
  return (await res.json()) as ConversationSummaryDto;
}

/** The acting user's bookmarked answers, most recent first (`GET /saved-answers`, M3.2). */
export async function listSavedAnswers(
  token: string,
  page: Page,
): Promise<SavedAnswerDto[]> {
  const res = await fetch(
    `${API_URL}/saved-answers?limit=${page.limit}&offset=${page.offset}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) {
    throw new Error(`saved-answers request failed (${res.status})`);
  }
  return (await res.json()) as SavedAnswerDto[];
}

/** Result of a bookmark attempt — `duplicate` when the answer was already saved (the API's 409). */
type SaveResult = "saved" | "duplicate";

/**
 * Bookmark an assistant answer (`POST /saved-answers`, M3.2). Only the `messageId` is sent — the
 * owning conversation is derived + ownership re-checked server-side. A 409 means it was already
 * bookmarked, which we surface as a benign `duplicate` rather than an error.
 */
export async function createSavedAnswer(
  token: string,
  messageId: string,
  note?: string,
): Promise<SaveResult> {
  const res = await fetch(`${API_URL}/saved-answers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ messageId, ...(note ? { note } : {}) }),
  });
  if (res.status === 409) return "duplicate";
  if (!res.ok) {
    throw new Error(`save failed (${res.status})`);
  }
  return "saved";
}

/** Remove a bookmark (`DELETE /saved-answers/:id`, M3.2). */
export async function removeSavedAnswer(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_URL}/saved-answers/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`remove failed (${res.status})`);
  }
}
