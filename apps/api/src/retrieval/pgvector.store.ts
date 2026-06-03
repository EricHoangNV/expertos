import {
  fuseHybrid,
  type RankedChunk,
  type RetrievalFilters,
  type RetrievalRequest,
  type RetrievedChunk,
  type VectorStore,
} from "@expertos/ai";
import type { Prisma } from "@expertos/db";
import { toVectorLiteral } from "../database/vector";

/** Over-fetch this multiple of `topK` per modality so fusion has material to re-rank. */
const CANDIDATE_MULTIPLIER = 4;
/** Hard cap on per-modality candidates, to bound query work. */
const MAX_CANDIDATES = 200;

/** Raw row shape from the cosine / keyword queries. */
interface ChunkRow {
  id: string;
  document_version_id: string;
  content: string;
  score: number;
}

/**
 * pgvector-backed hybrid {@link VectorStore} driver (M1.2): vector (cosine distance over
 * the HNSW `chunks.embedding` index) + keyword (Postgres full-text over content+summary) +
 * the metadata filters from the request, fused with RRF (see `@expertos/ai` `fuseHybrid`).
 *
 * It runs against a {@link Prisma.TransactionClient} that the caller has already scoped
 * with the acting user's RLS context (see {@link RetrievalService}), so tenant isolation
 * is enforced by Postgres — the SQL never expresses a `tenant_id` predicate. All filter
 * values are bound parameters, never interpolated (directive §1).
 */
export class PgVectorStore implements VectorStore {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async retrieve(request: RetrievalRequest): Promise<RetrievedChunk[]> {
    const candidates = Math.min(
      Math.max(request.topK * CANDIDATE_MULTIPLIER, request.topK),
      MAX_CANDIDATES,
    );

    const [vectorHits, keywordHits] = await Promise.all([
      this.vectorSearch(request, candidates),
      this.keywordSearch(request, candidates),
    ]);

    return fuseHybrid(vectorHits, keywordHits, request.topK);
  }

  private async vectorSearch(
    request: RetrievalRequest,
    limit: number,
  ): Promise<RankedChunk[]> {
    const vector = toVectorLiteral(request.embedding);
    // $1 = query vector; filter params follow; limit is last.
    const { clause, params } = buildFilterClause(request.filters, 1);
    const limitPlaceholder = `$${2 + params.length}`;
    const sql = `
      SELECT id, document_version_id, content,
             1 - (embedding <=> $1::vector) AS score
      FROM chunks
      WHERE ${clause} AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector ASC
      LIMIT ${limitPlaceholder}`;
    const rows = await this.tx.$queryRawUnsafe<ChunkRow[]>(
      sql,
      vector,
      ...params,
      limit,
    );
    return rows.map(toRankedChunk);
  }

  private async keywordSearch(
    request: RetrievalRequest,
    limit: number,
  ): Promise<RankedChunk[]> {
    const text = request.text.trim();
    if (text.length === 0) {
      return [];
    }
    // 'simple' config: no English-specific stemming, so it does not distort Vietnamese
    // (Open Decision #9). $1 = query text; filter params follow; limit is last.
    const tsv = "to_tsvector('simple', content || ' ' || coalesce(summary, ''))";
    const tsq = "websearch_to_tsquery('simple', $1)";
    const { clause, params } = buildFilterClause(request.filters, 1);
    const limitPlaceholder = `$${2 + params.length}`;
    const sql = `
      SELECT id, document_version_id, content,
             ts_rank(${tsv}, ${tsq}) AS score
      FROM chunks
      WHERE ${clause} AND ${tsv} @@ ${tsq}
      ORDER BY score DESC
      LIMIT ${limitPlaceholder}`;
    const rows = await this.tx.$queryRawUnsafe<ChunkRow[]>(
      sql,
      text,
      ...params,
      limit,
    );
    return rows.map(toRankedChunk);
  }
}

/**
 * Builds the metadata WHERE clause and its bound params. `offset` is the count of params
 * already bound before the filters (e.g. the query vector or query text), so placeholders
 * continue the sequence. `status` is always present; `language` / `scope` / `expertId` are
 * optional. All predicates qualify `chunks` columns explicitly so the optional `expertId`
 * EXISTS subquery (which references `chunks.document_version_id`) stays unambiguous.
 */
function buildFilterClause(
  filters: RetrievalFilters,
  offset: number,
): { clause: string; params: unknown[] } {
  const params: unknown[] = [];
  const clauses: string[] = [];

  clauses.push(`chunks.status = $${offset + params.length + 1}::chunk_status`);
  params.push(filters.status);

  if (filters.language) {
    clauses.push(`chunks.language = $${offset + params.length + 1}::language`);
    params.push(filters.language);
  }

  if (filters.scope && filters.scope.length > 0) {
    clauses.push(`chunks.scope = ANY($${offset + params.length + 1}::content_scope[])`);
    params.push(filters.scope);
  }

  // Expert-knowledge boundary (Security Cycle 2): restrict grounding to the selected expert's own
  // documents plus the unattributed/global corpus (`expert_id IS NULL`) — never another expert's.
  // Resolved by joining each chunk back through `document_versions` → `documents`; the subquery runs
  // under the same RLS-scoped transaction, so tenant isolation still holds.
  if (filters.expertId) {
    const p = offset + params.length + 1;
    clauses.push(
      `EXISTS (SELECT 1 FROM document_versions dv ` +
        `JOIN documents d ON d.id = dv.document_id ` +
        `WHERE dv.id = chunks.document_version_id ` +
        `AND (d.expert_id = $${p}::uuid OR d.expert_id IS NULL))`,
    );
    params.push(filters.expertId);
  }

  return { clause: clauses.join(" AND "), params };
}

function toRankedChunk(row: ChunkRow): RankedChunk {
  return {
    chunkId: row.id,
    documentVersionId: row.document_version_id,
    content: row.content,
    score: Number(row.score),
  };
}
