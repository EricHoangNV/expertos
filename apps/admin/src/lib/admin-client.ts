import type {
  EntitlementCellDto,
  EntitlementMatrixDto,
  EntitlementUpdateInput,
  KnowledgeDocumentDetailDto,
  KnowledgeDocumentDto,
  KnowledgeDraftDto,
  KnowledgeDraftStatusValue,
  KnowledgeDraftSummaryDto,
  KnowledgeDraftUpdateInput,
  KnowledgeVersionDto,
  PublishStatusValue,
  RecommendationRuleDto,
  RecommendationRuleUpdateInput,
  RecommendationRulesDto,
  RecommendationTriggerValue,
  RevenueReportDto,
  FailedQueryDto,
  AdminAuditLogDto,
  AdminFairUseFlagDto,
  AdminUserDetailDto,
  AdminUserRoleUpdateInput,
  AdminUserSummaryDto,
  DataDeletionRequestDto,
  FairUseFlagCreateInput,
  FairUseFlagUpdateInput,
  Role,
  UserDeletionResultDto,
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

// M8.3 — Admin revenue reports
export function getRevenueReport(
  token: string,
  months?: number,
): Promise<RevenueReportDto> {
  const query = months != null ? `?months=${months}` : "";
  return request<RevenueReportDto>(`/admin/revenue/report${query}`, token);
}

// M8.3 — Admin plan-entitlement matrix editor

/** The full plan × feature entitlement matrix. */
export function getEntitlementMatrix(token: string): Promise<EntitlementMatrixDto> {
  return request<EntitlementMatrixDto>("/admin/entitlements", token);
}

/** Save one (plan, feature) entitlement cell; identity is in the path, the value in the body. */
export function updateEntitlementCell(
  token: string,
  planId: string,
  featureId: string,
  body: EntitlementUpdateInput,
): Promise<EntitlementCellDto> {
  return request<EntitlementCellDto>(
    `/admin/entitlements/${planId}/features/${featureId}`,
    token,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

// M8.3 — Admin recommendation-rules editor

/** Every configured recommendation rule plus the consultation types a rule can point at. */
export function getRecommendationRules(token: string): Promise<RecommendationRulesDto> {
  return request<RecommendationRulesDto>("/admin/recommendation-rules", token);
}

/** Save one recommendation rule; the trigger (identity) is in the path, the value in the body. */
export function updateRecommendationRule(
  token: string,
  trigger: RecommendationTriggerValue,
  body: RecommendationRuleUpdateInput,
): Promise<RecommendationRuleDto> {
  return request<RecommendationRuleDto>(`/admin/recommendation-rules/${trigger}`, token, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// M8.3 — Admin failed / low-confidence query inspector

/** A page of the most-recent unhelpful-rated (👎) answers across all tenants, newest first. */
export function getFailedQueries(
  token: string,
  params?: { limit?: number; offset?: number },
): Promise<FailedQueryDto[]> {
  const search = new URLSearchParams();
  if (params?.limit != null) search.set("limit", String(params.limit));
  if (params?.offset != null) search.set("offset", String(params.offset));
  const query = search.toString();
  return request<FailedQueryDto[]>(`/admin/failed-queries${query ? `?${query}` : ""}`, token);
}

// ── M8.4 — user / subscription / fair-use management + user-data deletion ───

/** The user management list, optionally narrowed by role and/or an email/name substring. */
export function listUsers(
  token: string,
  params?: { role?: Role; search?: string; limit?: number; offset?: number },
): Promise<AdminUserSummaryDto[]> {
  const search = new URLSearchParams();
  if (params?.role != null) search.set("role", params.role);
  if (params?.search != null && params.search !== "") search.set("search", params.search);
  if (params?.limit != null) search.set("limit", String(params.limit));
  if (params?.offset != null) search.set("offset", String(params.offset));
  const query = search.toString();
  return request<AdminUserSummaryDto[]>(`/admin/users${query ? `?${query}` : ""}`, token);
}

/** One user's full detail (subscription, activity, fair-use flags, deletion request). */
export function getUser(token: string, id: string): Promise<AdminUserDetailDto> {
  return request<AdminUserDetailDto>(`/admin/users/${id}`, token);
}

/** Change a user's role. */
export function updateUserRole(
  token: string,
  id: string,
  body: AdminUserRoleUpdateInput,
): Promise<AdminUserSummaryDto> {
  return request<AdminUserSummaryDto>(`/admin/users/${id}/role`, token, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/** Raise a fair-use flag against a user. */
export function flagFairUse(
  token: string,
  id: string,
  body: FairUseFlagCreateInput,
): Promise<AdminFairUseFlagDto> {
  return request<AdminFairUseFlagDto>(`/admin/users/${id}/fair-use-flags`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Move a fair-use flag through its review lifecycle. */
export function updateFairUseFlag(
  token: string,
  id: string,
  body: FairUseFlagUpdateInput,
): Promise<AdminFairUseFlagDto> {
  return request<AdminFairUseFlagDto>(`/admin/fair-use-flags/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/** Record a user-data deletion request (the workflow row, before the destructive execution). */
export function requestUserDeletion(token: string, id: string): Promise<DataDeletionRequestDto> {
  return request<DataDeletionRequestDto>(`/admin/users/${id}/deletion-request`, token, {
    method: "POST",
  });
}

/** Hard-delete a user and all their owned data (the GDPR cascade). */
export function deleteUser(token: string, id: string): Promise<UserDeletionResultDto> {
  return request<UserDeletionResultDto>(`/admin/users/${id}`, token, { method: "DELETE" });
}

/** A page of admin audit-log entries, newest first; optionally filtered. */
export function getAuditLogs(
  token: string,
  params?: { action?: string; targetType?: string; limit?: number; offset?: number },
): Promise<AdminAuditLogDto[]> {
  const search = new URLSearchParams();
  if (params?.action != null && params.action !== "") search.set("action", params.action);
  if (params?.targetType != null && params.targetType !== "")
    search.set("targetType", params.targetType);
  if (params?.limit != null) search.set("limit", String(params.limit));
  if (params?.offset != null) search.set("offset", String(params.offset));
  const query = search.toString();
  return request<AdminAuditLogDto[]>(`/admin/audit-logs${query ? `?${query}` : ""}`, token);
}
