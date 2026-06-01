import { Injectable } from "@nestjs/common";
import type { FailedQueryDto, FailedQueryListQueryInput } from "@expertos/shared";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";

/** Raw row shape the inspector SQL returns (snake_case columns from Postgres). */
interface FailedQueryRow {
  feedback_id: string;
  message_id: string;
  conversation_id: string;
  question: string | null;
  answer: string;
  reason: string | null;
  model: string | null;
  confidence: number | null;
  insufficient_knowledge: boolean;
  created_at: Date;
}

/**
 * The admin failed / low-confidence query inspector (M8.3, PRD §"Admin" → "failed/low-confidence
 * query inspector"). The single **read-only** choke point behind `GET /admin/failed-queries`; it
 * surfaces the answers users rated unhelpful (👎) so an expert can triage weak answers and route
 * them back into knowledge (a hand-off to the M8.2 "mark valuable" draft pipeline).
 *
 * Runs inside {@link RlsService.run} under an **admin** principal, so the `is_admin` GUC makes the
 * read **platform-wide across all tenants** (the same cross-tenant pattern {@link RevenueService} /
 * {@link EntitlementMatrixService} use) — that's why no `tenant_id` predicate ever appears. The route
 * guard (`@Roles("admin")`) is what guarantees the caller is actually an admin.
 *
 * Raw SQL is required (the M3.3 conversation-search precedent): the question is the most-recent user
 * message at/before the answer in the same conversation — a per-row `LATERAL` lookup with no Prisma
 * Client expression. The answer's `insufficientKnowledge` flag is derived from its `source_version_ids`
 * being empty (the deterministic insufficient-knowledge proxy, mirroring `ChatService.answerStream`).
 */
@Injectable()
export class FailedQueryService {
  constructor(private readonly rls: RlsService) {}

  /** A page of the most-recent unhelpful-rated answers, newest first. */
  async list(user: AuthUser, query: FailedQueryListQueryInput): Promise<FailedQueryDto[]> {
    return this.rls.run(user, async (tx) => {
      const rows = await tx.$queryRawUnsafe<FailedQueryRow[]>(
        INSPECTOR_SQL,
        query.limit,
        query.offset,
      );
      return rows.map(toFailedQueryDto);
    });
  }
}

/** Flatten a raw {@link FailedQueryRow} into the public {@link FailedQueryDto}. */
function toFailedQueryDto(row: FailedQueryRow): FailedQueryDto {
  return {
    feedbackId: row.feedback_id,
    messageId: row.message_id,
    conversationId: row.conversation_id,
    question: row.question,
    answer: row.answer,
    reason: row.reason,
    model: row.model,
    confidence: row.confidence,
    insufficientKnowledge: row.insufficient_knowledge,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * The unhelpful-rated-answer feed. `$1` = limit, `$2` = offset. Joins each `answer_feedback` row
 * (`helpful = false`) to its rated assistant message, derives the insufficient-knowledge flag from
 * the message's empty `source_version_ids`, and `LATERAL`-joins back to the most-recent user message
 * at/before the answer for the original question (the question role filter means the `<=` can never
 * pick the answer itself). RLS scopes the tables (admin GUC → all tenants); no `tenant_id` predicate.
 */
const INSPECTOR_SQL = `
  SELECT
    f.id                                    AS feedback_id,
    f.message_id                            AS message_id,
    m.conversation_id                       AS conversation_id,
    m.content                               AS answer,
    m.model                                 AS model,
    m.confidence                            AS confidence,
    (cardinality(m.source_version_ids) = 0) AS insufficient_knowledge,
    f.reason                                AS reason,
    f.created_at                            AS created_at,
    q.content                               AS question
  FROM answer_feedback f
  JOIN messages m ON m.id = f.message_id
  LEFT JOIN LATERAL (
    SELECT um.content
    FROM messages um
    WHERE um.conversation_id = m.conversation_id
      AND um.role = 'user'::message_role
      AND um.created_at <= m.created_at
    ORDER BY um.created_at DESC
    LIMIT 1
  ) q ON true
  WHERE f.helpful = false
  ORDER BY f.created_at DESC
  LIMIT $1 OFFSET $2`;
