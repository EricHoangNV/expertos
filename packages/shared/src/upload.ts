import { z } from "zod";

/**
 * Retention/indexing mode for a query-time upload (M5.2, PRD §"Document-assisted Q&A"):
 * - `temporary` (default) — short configurable retention; the file's chunks are scoped to the
 *   asking user's session (`temporary_upload`) and excluded from the searchable knowledge base;
 *   the row carries an `expiresAt` so a sweeper can reclaim it.
 * - `persistent` — the file is indexed into the user's private knowledge (`user_private` scope) and
 *   does not expire, so later questions can retrieve it.
 */
const uploadModeSchema = z.enum(["temporary", "persistent"]);

export type UploadMode = z.infer<typeof uploadModeSchema>;

/**
 * Query-time document upload (M5.1/M5.2, PRD §"Document-assisted Q&A"). The file itself arrives as
 * multipart form-data (validated for type/size/malware server-side); this schema validates only
 * the accompanying JSON fields. A query-time upload may be attached to the conversation it was
 * uploaded into (`conversationId`); ownership of that conversation is re-checked server-side
 * (directive §26), and tenant/user isolation is enforced by Postgres RLS (directive §4.21), so no
 * `tenant_id`/`user_id` appears here.
 *
 * `mode` selects the retention + indexing strategy (see {@link uploadModeSchema}); it defaults to
 * `temporary` so an omitted field keeps the M5.1 behavior.
 */
export const uploadCreateSchema = z.object({
  /** Attach the upload to an existing conversation; omitted = a standalone upload. */
  conversationId: z.string().uuid().optional(),
  /** Retention/indexing mode; defaults to `temporary`. */
  mode: uploadModeSchema.default("temporary"),
});

export type UploadCreateInput = z.infer<typeof uploadCreateSchema>;

/**
 * Query string for the "My Knowledge" upload list (M18.2, PRD §"M18 — Uploaded document
 * management"). `scope` narrows the list to one retention mode so the page can render a
 * Saved (persistent) section and a Temporary (expiring) section independently:
 * - `persistent` — only `mode: "persistent"` uploads (saved private knowledge);
 * - `temporary` — only `mode: "temporary"` uploads (expiring, conversation-scoped);
 * - `all` (default) — every upload the caller owns, newest-first.
 *
 * It does **not** carry `tenant_id`/`user_id`: ownership is enforced by Postgres RLS inside the
 * service (directive §4.21), so a peer's uploads are never listable regardless of the query.
 */
export const uploadListQuerySchema = z.object({
  scope: z.enum(["persistent", "temporary", "all"]).default("all"),
});

export type UploadListQuery = z.infer<typeof uploadListQuerySchema>;

/**
 * An uploaded file as returned to the client after a successful upload (M5.1/M5.2). `scanClean` is
 * the malware-scan verdict (always `true` here — an infected file is rejected, never persisted, so
 * the client never sees a `false`); the nullable type carries the not-yet-scanned shape for forward
 * compatibility. `mode` is the retention mode the row was stored under. `chunkCount` is how many
 * searchable chunks the file was indexed into — `0` for a format whose parser has not landed yet
 * (PDF/DOCX/XLSX binary parsing is M5.3), so the client can tell whether the upload is queryable.
 * `expiresAt` is set for `temporary` uploads and `null` for `persistent` ones.
 */
export interface UploadedFileDto {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  mode: UploadMode;
  chunkCount: number;
  scanned: boolean;
  scanClean: boolean | null;
  conversationId: string | null;
  /** ISO-8601 timestamp, or `null` for a `persistent` upload that never expires. */
  expiresAt: string | null;
  /** ISO-8601 timestamp. */
  createdAt: string;
}
