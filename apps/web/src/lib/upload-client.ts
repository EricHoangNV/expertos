import type { UploadedFileDto, UploadMode } from "@expertos/shared";

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
    throw new Error(await errorMessage(res));
  }
  return (await res.json()) as UploadedFileDto;
}

/**
 * Extracts a human-readable message from a failed upload response. The API returns Nest's
 * `{ message }` body for a rejected upload (415 unsupported, 413 too large, 422 malware, 400 spoof);
 * fall back to the status code when the body isn't the expected JSON shape.
 */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.length > 0) {
      return body.message;
    }
  } catch {
    // Non-JSON body — fall through to the generic status message.
  }
  return `upload failed (${res.status})`;
}
