import { z } from "zod";

/**
 * Query-time document upload (M5.1, PRD §"Document-assisted Q&A"). The file itself arrives as
 * multipart form-data (validated for type/size/malware server-side); this schema validates only
 * the accompanying JSON fields. A query-time upload may be attached to the conversation it was
 * uploaded into (`conversationId`); ownership of that conversation is re-checked server-side
 * (directive §26), and tenant/user isolation is enforced by Postgres RLS (directive §4.21), so no
 * `tenant_id`/`user_id` appears here.
 *
 * Temporary-vs-persistent mode + retention/indexing strategy is M5.2; M5.1 records every upload
 * under the schema/DB default (`temporary`) and only proves the validated upload path.
 */
export const uploadCreateSchema = z.object({
  /** Attach the upload to an existing conversation; omitted = a standalone upload. */
  conversationId: z.string().uuid().optional(),
});

export type UploadCreateInput = z.infer<typeof uploadCreateSchema>;

/**
 * An uploaded file as returned to the client after a successful upload (M5.1). `scanClean` is the
 * malware-scan verdict (always `true` here — an infected file is rejected, never persisted, so the
 * client never sees a `false`); the nullable type carries the not-yet-scanned shape for forward
 * compatibility. `mode` is the retention mode the row was stored under (`temporary` until M5.2).
 */
export interface UploadedFileDto {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  mode: "temporary" | "persistent";
  scanned: boolean;
  scanClean: boolean | null;
  conversationId: string | null;
  /** ISO-8601 timestamp. */
  createdAt: string;
}
