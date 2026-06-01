import type {
  KnowledgeDocumentDetailDto,
  KnowledgeDocumentDto,
  KnowledgeDraftDto,
  KnowledgeDraftStatusValue,
  KnowledgeDraftSummaryDto,
  KnowledgeDraftUpdateInput,
  KnowledgeVersionDto,
  PublishStatusValue,
} from "@expertos/shared";

/**
 * Admin/expert portal API client (M8.1 + M8.2). Mirrors `apps/web/src/lib/chat-client.ts`:
 * every call carries the Firebase ID token as a Bearer header; the API enforces the
 * `expert`/`admin` role gate + tenant RLS, so this layer is a thin typed fetch wrapper that
 * surfaces a useful error on a non-2xx response.
 *
 * The value is public — it only identifies the endpoint; production passes `NEXT_PUBLIC_API_URL`
 * as a build arg.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Lifecycle actions a reviewer can drive a knowledge *version* through (M8.1). */
export type VersionAction = "submit" | "approve" | "request-changes" | "archive";

/** Lifecycle actions a reviewer can drive a *draft* through (M8.2). */
export type DraftAction = "submit" | "request-changes" | "reject" | "publish";

async function request<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body != null ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res));
  }
  return (await res.json()) as T;
}

/** Best-effort human message from an API error body (`{ message }` / `{ reason }`), else the status. */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      const detail = record.message ?? record.reason;
      if (typeof detail === "string") return detail;
      if (Array.isArray(detail) && typeof detail[0] === "string") return detail[0];
    }
  } catch {
    /* non-JSON body — fall through to the status line */
  }
  return `Request failed (${res.status})`;
}

// ── M8.1 — versioned knowledge publish workflow ────────────────────────────

/** The knowledge review queue, optionally narrowed to one publish status. */
export function listDocuments(
  token: string,
  status?: PublishStatusValue,
): Promise<KnowledgeDocumentDto[]> {
  const query = status ? `?status=${status}` : "";
  return request<KnowledgeDocumentDto[]>(`/knowledge/documents${query}`, token);
}

/** One document with its full version history. */
export function getDocument(
  token: string,
  id: string,
): Promise<KnowledgeDocumentDetailDto> {
  return request<KnowledgeDocumentDetailDto>(`/knowledge/documents/${id}`, token);
}

/** Drive a version through the publish lifecycle. */
export function versionAction(
  token: string,
  versionId: string,
  action: VersionAction,
): Promise<KnowledgeVersionDto> {
  return request<KnowledgeVersionDto>(
    `/knowledge/versions/${versionId}/${action}`,
    token,
    { method: "POST" },
  );
}

// ── M8.2 — conversation-to-knowledge draft pipeline ────────────────────────

/** The draft review queue, optionally narrowed to one status. */
export function listDrafts(
  token: string,
  status?: KnowledgeDraftStatusValue,
): Promise<KnowledgeDraftSummaryDto[]> {
  const query = status ? `?status=${status}` : "";
  return request<KnowledgeDraftSummaryDto[]>(`/knowledge-drafts${query}`, token);
}

/** One draft with its full body content. */
export function getDraft(token: string, id: string): Promise<KnowledgeDraftDto> {
  return request<KnowledgeDraftDto>(`/knowledge-drafts/${id}`, token);
}

/** Edit a draft's title/content (allowed only while it is still `draft`). */
export function updateDraft(
  token: string,
  id: string,
  body: KnowledgeDraftUpdateInput,
): Promise<KnowledgeDraftDto> {
  return request<KnowledgeDraftDto>(`/knowledge-drafts/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/** Drive a draft through the review/publish lifecycle. */
export function draftAction(
  token: string,
  id: string,
  action: DraftAction,
): Promise<KnowledgeDraftDto> {
  return request<KnowledgeDraftDto>(`/knowledge-drafts/${id}/${action}`, token, {
    method: "POST",
  });
}
