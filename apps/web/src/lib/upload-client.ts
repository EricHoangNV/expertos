import type { EntitlementDeniedPayload, UploadedFileDto, UploadMode } from "@expertos/shared";

/**
 * Thrown when an upload is blocked by the `@RequiresEntitlement("document_upload")` guard (402):
 * the acting plan doesn't include document upload, or a metered cap was hit. Carries the API's
 * {@link EntitlementDeniedPayload} so the caller can render a friendly, localized upgrade prompt
 * (with the offered higher tiers) instead of the framework's bare "Http Exception" string — the 402
 * body has no user-facing `message`, only the structured entitlement fields. Enforcement is
 * unchanged; this only improves how the rejection surfaces (DIRECTIVE #44, FEEDBACKS Product Cycle 1).
 */
export class UploadEntitlementError extends Error {
  constructor(readonly payload: EntitlementDeniedPayload) {
    super(payload.reason);
    this.name = "UploadEntitlementError";
  }
}

/**
 * Base URL of the API. Defaults to the local dev port; production passes `NEXT_PUBLIC_API_URL`
 * as a build arg (the value is public — it only identifies the endpoint). Mirrors `chat-client.ts`.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * MIME types the API allowlists for query-time uploads (mirrors `UPLOAD_TYPES` server-side: PDF,
 * XLSX, CSV, DOCX, Markdown, plain text). Used for the file picker's `accept` hint — the server is
 * still the authority (it re-validates the type, extension, magic bytes and scans for malware), so
 * this only narrows the native picker; a spoofed type is rejected with a clear error regardless.
 */
export const UPLOAD_ACCEPT =
  ".txt,.md,.markdown,.csv,.pdf,.docx,.xlsx," +
  "text/plain,text/markdown,text/csv,application/pdf," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Uploads a query-time document (M5.1/M5.2). The file is sent as multipart form-data alongside the
 * JSON fields the API's `uploadCreateSchema` validates (`mode`, optional `conversationId`); the
 * `Content-Type` header is deliberately left unset so the browser writes the multipart boundary.
 * A `persistent` upload is indexed into the user's private knowledge (retrievable by later
 * questions); a `temporary` upload is scoped to the attached conversation and expires.
 *
 * Validation/scan/store all happen server-side under RLS; a rejected file (unsupported type,
 * oversize, failed malware scan) surfaces the API's `{message}` so the caller can show it verbatim.
 */
export async function uploadFile(
  token: string,
  file: File,
  mode: UploadMode,
  conversationId?: string,
): Promise<UploadedFileDto> {
  const form = new FormData();
  form.append("file", file);
  form.append("mode", mode);
  if (conversationId) {
    form.append("conversationId", conversationId);
  }
  const res = await fetch(`${API_URL}/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    // Read the body once, then branch: an entitlement-denied 402 carries the structured upgrade
    // payload (no user-facing `message`) and becomes a typed error the UI can localize; everything
    // else (415 unsupported, 413 too large, 422 malware, 400 spoof) carries Nest's `{ message }`.
    const body = await readErrorBody(res);
    if (res.status === 402 && isEntitlementDenied(body)) {
      throw new UploadEntitlementError(body);
    }
    throw new Error(messageFrom(body, res.status));
  }
  return (await res.json()) as UploadedFileDto;
}

/** Reads a response body as JSON, best-effort (a non-JSON body yields `null`). */
async function readErrorBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Narrows a parsed body to the 402 entitlement-denied payload shape. */
function isEntitlementDenied(body: unknown): body is EntitlementDeniedPayload {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as Record<string, unknown>;
  return (
    (candidate.reason === "feature_disabled" || candidate.reason === "quota_exceeded") &&
    typeof candidate.feature === "string" &&
    Array.isArray(candidate.upgradeOptions)
  );
}

/**
 * Extracts a human-readable message from a failed upload body. The API returns Nest's `{ message }`
 * for a rejected upload; fall back to the status code when the body isn't the expected JSON shape.
 */
function messageFrom(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return `upload failed (${status})`;
}
