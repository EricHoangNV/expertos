import type { Prisma } from "@expertos/db";
import { toVectorLiteral } from "../database/vector";

/** A query-time upload chunk request, vector-ranked against the user's own uploaded files. */
interface UploadRetrievalRequest {
  /** Query embedding; same model/space as ingestion + knowledge retrieval. */
  embedding: number[];
  /** Max upload chunks returned. */
  topK: number;
  /**
   * The conversation the turn belongs to, if any. A `temporary` upload is only foldable into the
   * conversation it was attached to; omitting this restricts the result to `persistent` uploads.
   */
  conversationId?: string;
}

/** A retrieved upload chunk plus the provenance the chat layer turns into an upload citation. */
export interface RetrievedUploadChunk {
  uploadChunkId: string;
  uploadedFileId: string;
  filename: string;
  content: string;
  /** Cosine similarity to the query (1 = identical). */
  score: number;
  /** Sheet/tab name for a spreadsheet chunk (M5.3); null for prose. */
  sheetName: string | null;
  /** A1 cell range a spreadsheet chunk covers (M5.3); null for prose. */
  cellRef: string | null;
}

/** Raw row shape from the upload cosine query. */
interface UploadChunkRow {
  id: string;
  uploaded_file_id: string;
  filename: string;
  content: string;
  sheet_name: string | null;
  cell_ref: string | null;
  score: number;
}

/**
 * pgvector-backed retrieval over a user's own query-time uploads (M5.4). It folds the M5.1–M5.3
 * `upload_chunks` write path into chat retrieval: a question can now be grounded on the asker's
 * uploaded document, cited distinctly from published expert knowledge (info-blue `.cite.upload`).
 *
 * **Which uploads are in scope** follows the M5.2 mode contract:
 * - `persistent` uploads are always foldable (the user chose to keep them searchable).
 * - `temporary` uploads are session-scoped — only the ones attached to the *current* conversation,
 *   and only while unexpired (a sweeper reclaims them after their retention window, but until it
 *   runs they must not resurface, so expiry is filtered here defensively).
 *
 * **Isolation is RLS, not a predicate.** `upload_chunks` is `tenant_only` but `uploaded_files` is
 * `user_scoped`; running inside the acting user's RLS context (see {@link
 * import("./retrieval.service").RetrievalService}) means the JOIN to `uploaded_files` only matches
 * the user's own files — so the SQL never expresses a `tenant_id`/`user_id` predicate (directive
 * §4.21). All values are bound parameters, never interpolated (directive §1).
 */
export class PgUploadChunkStore {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async retrieve(request: UploadRetrievalRequest): Promise<RetrievedUploadChunk[]> {
    const vector = toVectorLiteral(request.embedding);
    // $1 = query vector; an optional conversation id follows; the limit is last.
    const params: unknown[] = [vector];

    let temporaryClause = "false";
    if (request.conversationId) {
      params.push(request.conversationId);
      temporaryClause = `(uf.mode = 'temporary'
        AND uf.conversation_id = $${params.length}::uuid
        AND (uf.expires_at IS NULL OR uf.expires_at > now()))`;
    }

    params.push(request.topK);
    const limitPlaceholder = `$${params.length}`;

    const sql = `
      SELECT uc.id, uc.uploaded_file_id, uc.content, uc.sheet_name, uc.cell_ref,
             uf.filename,
             1 - (uc.embedding <=> $1::vector) AS score
      FROM upload_chunks uc
      JOIN uploaded_files uf ON uf.id = uc.uploaded_file_id
      WHERE uc.embedding IS NOT NULL
        AND (uf.mode = 'persistent' OR ${temporaryClause})
      ORDER BY uc.embedding <=> $1::vector ASC
      LIMIT ${limitPlaceholder}`;

    const rows = await this.tx.$queryRawUnsafe<UploadChunkRow[]>(sql, ...params);
    return rows.map(toRetrievedUploadChunk);
  }
}

function toRetrievedUploadChunk(row: UploadChunkRow): RetrievedUploadChunk {
  return {
    uploadChunkId: row.id,
    uploadedFileId: row.uploaded_file_id,
    filename: row.filename,
    content: row.content,
    score: Number(row.score),
    sheetName: row.sheet_name,
    cellRef: row.cell_ref,
  };
}
