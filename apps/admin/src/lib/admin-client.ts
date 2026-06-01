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
  LanguageValue,
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
  AdminExpertSummaryDto,
  AdminExpertDetailDto,
  AdminExpertCreateInput,
  AdminExpertUpdateInput,
  VoiceProfileCreateInput,
  VoiceProfileUpdateInput,
  ExpertConversionsDto,
  ExpertAnswerReviewDto,
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

// ── M8.4 — expert-roster management ─────────────────────────────────────────

/** The expert management list, optionally narrowed by active state and/or a slug/name substring. */
export function listExperts(
  token: string,
  params?: { active?: boolean; search?: string; limit?: number; offset?: number },
): Promise<AdminExpertSummaryDto[]> {
  const search = new URLSearchParams();
  if (params?.active != null) search.set("active", String(params.active));
  if (params?.search != null && params.search !== "") search.set("search", params.search);
  if (params?.limit != null) search.set("limit", String(params.limit));
  if (params?.offset != null) search.set("offset", String(params.offset));
  const query = search.toString();
  return request<AdminExpertSummaryDto[]>(`/admin/experts${query ? `?${query}` : ""}`, token);
}

/** One expert's full detail (operator link + content counts). */
export function getExpert(token: string, id: string): Promise<AdminExpertDetailDto> {
  return request<AdminExpertDetailDto>(`/admin/experts/${id}`, token);
}

/** Author a new expert. */
export function createExpert(
  token: string,
  body: AdminExpertCreateInput,
): Promise<AdminExpertDetailDto> {
  return request<AdminExpertDetailDto>(`/admin/experts`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Edit an expert's free-text fields and/or operator link. */
export function updateExpert(
  token: string,
  id: string,
  body: AdminExpertUpdateInput,
): Promise<AdminExpertDetailDto> {
  return request<AdminExpertDetailDto>(`/admin/experts/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/** Activate / deactivate an expert. */
export function setExpertActive(
  token: string,
  id: string,
  active: boolean,
): Promise<AdminExpertDetailDto> {
  return request<AdminExpertDetailDto>(`/admin/experts/${id}/active`, token, {
    method: "PATCH",
    body: JSON.stringify({ active }),
  });
}

// ── M8.4 — voice-profile administration (over the M2.3 /voice-profiles routes) ──

/**
 * A voice profile as returned by the M2.3 `/voice-profiles` routes. Mirrors the API-local
 * `VoiceProfileSummary` but with the wire (JSON) shape: dates are ISO strings, language a plain
 * string. Kept here (not in `@expertos/shared`) because the API type carries `Date`/`@expertos/ai`
 * types that aren't wire-friendly; the admin UI only displays these fields.
 */
export interface VoiceProfileAdminDto {
  id: string;
  expertId: string;
  expertName: string;
  language: string;
  name: string;
  description: string | null;
  guidelines: string | null;
  status: PublishStatusValue;
  approvedBy: string | null;
  approvedAt: string | null;
  updatedAt: string;
}

/** Sign-off lifecycle actions a reviewer can drive a voice profile through (M2.3). */
export type VoiceProfileAction = "submit" | "approve" | "request-changes";

/** The voice-profile sign-off queue / authoring list (admin sees every profile in the tenant). */
export function listVoiceProfiles(
  token: string,
  params?: { status?: PublishStatusValue; expertId?: string; language?: LanguageValue },
): Promise<VoiceProfileAdminDto[]> {
  const search = new URLSearchParams();
  if (params?.status != null) search.set("status", params.status);
  if (params?.expertId != null && params.expertId !== "") search.set("expertId", params.expertId);
  if (params?.language != null) search.set("language", params.language);
  const query = search.toString();
  return request<VoiceProfileAdminDto[]>(`/voice-profiles${query ? `?${query}` : ""}`, token);
}

/** Author a new draft voice profile for an expert. */
export function createVoiceProfile(
  token: string,
  body: VoiceProfileCreateInput,
): Promise<VoiceProfileAdminDto> {
  return request<VoiceProfileAdminDto>(`/voice-profiles`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Edit a draft voice profile's free-text fields. */
export function updateVoiceProfile(
  token: string,
  id: string,
  body: VoiceProfileUpdateInput,
): Promise<VoiceProfileAdminDto> {
  return request<VoiceProfileAdminDto>(`/voice-profiles/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/** Drive a voice profile through the sign-off lifecycle. */
export function voiceProfileAction(
  token: string,
  id: string,
  action: VoiceProfileAction,
): Promise<VoiceProfileAdminDto> {
  return request<VoiceProfileAdminDto>(`/voice-profiles/${id}/${action}`, token, {
    method: "POST",
  });
}

// ── session identity (role gating) ──────────────────────────────────────────

/** The authenticated principal echoed by `GET /me` — the portal reads `role` to gate its nav. */
interface MeDto {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
}

/** Resolve the signed-in principal (used to gate the portal nav by role). */
export function getMe(token: string): Promise<MeDto> {
  return request<MeDto>("/me", token);
}

// ── M8.5 — expert portal (conversions + AI-answer review) ───────────────────

/**
 * Consultation-conversion summary for the expert's voice. A non-admin expert is scoped to their own
 * voice (omit `expertId`); an admin targets a specific expert by id.
 */
export function getExpertConversions(
  token: string,
  expertId?: string,
): Promise<ExpertConversionsDto> {
  const query = expertId != null && expertId !== "" ? `?expertId=${expertId}` : "";
  return request<ExpertConversionsDto>(`/expert/conversions${query}`, token);
}

/** A page of AI answers rendered in the expert's voice, newest first, for review. */
export function getExpertAnswers(
  token: string,
  params?: { expertId?: string; limit?: number; offset?: number },
): Promise<ExpertAnswerReviewDto[]> {
  const search = new URLSearchParams();
  if (params?.expertId != null && params.expertId !== "") search.set("expertId", params.expertId);
  if (params?.limit != null) search.set("limit", String(params.limit));
  if (params?.offset != null) search.set("offset", String(params.offset));
  const query = search.toString();
  return request<ExpertAnswerReviewDto[]>(`/expert/answers${query ? `?${query}` : ""}`, token);
}
