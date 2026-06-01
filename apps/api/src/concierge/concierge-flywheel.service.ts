import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { applyRlsContext, type Prisma, type PrismaClient } from "@expertos/db";
import { type EmbeddingProvider } from "@expertos/ai";
import type { ReviewVerdictValue } from "@expertos/shared";
import { PRISMA } from "../database/database.module";
import { StructuredLogger } from "../observability/logger.service";
import { toVectorLiteral } from "../database/vector";
import { CONCIERGE_EMBEDDING_PROVIDER } from "./concierge.tokens";

/** The reviewer-verdict signals the flywheel acts on (gathered by {@link ConciergeReviewService}). */
export interface FlywheelInput {
  /** The answered `human_review_requests` row. */
  reviewRequestId: string;
  /** The tenant the review belongs to (the elevated context is re-bounded to it). */
  tenantId: string;
  /** The reviewer's verdict. */
  verdict: ReviewVerdictValue;
  /** The improved answer text (the reviewer's edit, or the original when they only rated it). */
  improvedAnswer: string;
  /** True when the reviewer actually changed the answer (vs a verdict-only response). */
  edited: boolean;
}

/** Max characters of the prompting question used as a knowledge-draft title. */
const DRAFT_TITLE_CHARS = 80;

/** What the first elevated transaction resolved that the (out-of-tx) embed + voice insert needs. */
interface VoicePlan {
  voiceProfileId: string;
  prompt: string | null;
  content: string;
  language: string;
}

/**
 * The reviewer-feedback **flywheel** (M9.4, PRD §"Concierge Mode" → "Reviewer feedback loop").
 *
 * Invoked by {@link ConciergeReviewService} right after a reviewer records a verdict, it turns that
 * human touch into durable knowledge + voice signal so semantically-similar future questions retrieve
 * the improved, human-validated material (the RAG + voice flywheel):
 *
 *   - **Great / edited** → a `knowledge_drafts` row (the conversation Q&A → Expert Review → publish,
 *     re-embedded by the M1.1 ingestion pipeline) **and** a `voice_examples` row on the expert's
 *     published voice profile (embedded here with the same model as voice retrieval — M2.1).
 *   - **Bad** → flags the answer's source chunks (`chunks.flag_count` / `last_flagged_at`) so the
 *     failed-query / knowledge-quality inspector (M10.3) surfaces weak material for re-authoring.
 *
 * Isolation mirrors {@link ConciergeQueueService}: the review request is `user_scoped`, the writes
 * span `tenant_only` (drafts/voice) + `knowledge` (chunks) tables, so everything runs in an
 * **elevated** ({@link applyRlsContext} `is_admin`) context re-bounded to the caller's tenant. The
 * embedding call is made **outside** the transaction (no network inside a DB tx).
 *
 * It is **non-fatal by design**: any failure is caught and logged, never propagated — a flywheel
 * hiccup must not roll back or fail the reviewer's recorded verdict (the primary action). The
 * immediate same-conversation half of the loop ("inject the corrected answer into context") lives in
 * `ConversationService.loadHistory`, which substitutes the latest edited revision into prompt history.
 */
@Injectable()
export class ConciergeFlywheelService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CONCIERGE_EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    private readonly logger: StructuredLogger,
  ) {}

  /** Applies the global flywheel for one reviewed answer. Best-effort — swallows all errors. */
  async applyReviewOutcome(input: FlywheelInput): Promise<void> {
    try {
      const plan = await this.runSystem(input.tenantId, (tx) => this.persist(tx, input));
      if (plan) {
        const [embedding] = await this.embeddings.embed([plan.content]);
        await this.runSystem(input.tenantId, (tx) =>
          this.insertVoiceExample(tx, input.tenantId, plan, embedding),
        );
      }
    } catch (error) {
      this.logger.error("concierge flywheel failed", {
        reviewRequestId: input.reviewRequestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * The transactional half: mint the knowledge draft (great/edited), flag chunks (bad), and resolve
   * the voice-example plan (returned so the embed + insert happen outside this transaction).
   */
  private async persist(
    tx: Prisma.TransactionClient,
    input: FlywheelInput,
  ): Promise<VoicePlan | null> {
    const request = await tx.humanReviewRequest.findUnique({
      where: { id: input.reviewRequestId },
      select: {
        messageId: true,
        message: {
          select: {
            content: true,
            createdAt: true,
            conversationId: true,
            conversation: { select: { expertId: true, language: true } },
          },
        },
      },
    });
    if (!request) {
      return null;
    }
    const { messageId, message } = request;
    const language = message.conversation.language;
    const expertId = message.conversation.expertId;

    if (input.verdict === "bad") {
      await this.flagSourceChunks(tx, messageId);
    }

    const positive = input.verdict === "great" || input.edited;
    if (!positive) {
      return null;
    }

    const question = await tx.message.findFirst({
      where: {
        conversationId: message.conversationId,
        role: "user",
        createdAt: { lte: message.createdAt },
      },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    });
    const questionText = question?.content ?? null;

    await tx.knowledgeDraft.create({
      data: {
        tenantId: input.tenantId,
        conversationId: message.conversationId,
        expertId,
        title: draftTitle(questionText),
        content: draftContent(questionText, input.improvedAnswer),
        language,
        status: "draft",
      },
    });

    this.logger.info("concierge flywheel drafted knowledge", {
      reviewRequestId: input.reviewRequestId,
      conversationId: message.conversationId,
    });

    if (!expertId) {
      return null;
    }
    const profile = await tx.voiceProfile.findFirst({
      where: { expertId, language, status: "published" },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (!profile) {
      return null;
    }
    return {
      voiceProfileId: profile.id,
      prompt: questionText,
      content: input.improvedAnswer,
      language,
    };
  }

  /** Increments the flag counter on every knowledge chunk that grounded the bad answer. */
  private async flagSourceChunks(tx: Prisma.TransactionClient, messageId: string): Promise<void> {
    const citations = await tx.citation.findMany({
      where: { messageId, chunkId: { not: null } },
      select: { chunkId: true },
    });
    const chunkIds = [...new Set(citations.map((c) => c.chunkId).filter((id): id is string => id !== null))];
    if (chunkIds.length === 0) {
      return;
    }
    await tx.chunk.updateMany({
      where: { id: { in: chunkIds } },
      data: { flagCount: { increment: 1 }, lastFlaggedAt: new Date() },
    });
    this.logger.info("concierge flywheel flagged chunks", { messageId, count: chunkIds.length });
  }

  /**
   * Inserts the captured voice example with its embedding. Raw SQL because Prisma cannot write the
   * `Unsupported("vector")` column; all values are bound parameters (directive §1). The embedding
   * MUST be produced by the same model as voice retrieval (the injected provider).
   */
  private async insertVoiceExample(
    tx: Prisma.TransactionClient,
    tenantId: string,
    plan: VoicePlan,
    embedding: number[],
  ): Promise<void> {
    await tx.$executeRawUnsafe(
      `INSERT INTO voice_examples (id, tenant_id, voice_profile_id, prompt, content, language, embedding, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::language, $7::vector, now())`,
      randomUUID(),
      tenantId,
      plan.voiceProfileId,
      plan.prompt,
      plan.content,
      plan.language,
      toVectorLiteral(embedding),
    );
    this.logger.info("concierge flywheel captured voice example", {
      voiceProfileId: plan.voiceProfileId,
    });
  }

  /**
   * Runs flywheel writes in an elevated (`is_admin`) context re-bounded to the tenant, so they can
   * reach the customer's `user_scoped` review request and pass the WITH-CHECK on the tenant-scoped
   * draft/voice rows. Mirrors {@link ConciergeQueueService}'s `runSystem`.
   */
  private runSystem<T>(
    tenantId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await applyRlsContext(tx, { tenantId, isAdmin: true });
      return work(tx);
    });
  }
}

/** A short, human-readable title for the draft, from the prompting question. */
function draftTitle(question: string | null): string {
  const base = question?.trim();
  if (!base) {
    return "Reviewed answer";
  }
  return base.length > DRAFT_TITLE_CHARS ? `${base.slice(0, DRAFT_TITLE_CHARS)}…` : base;
}

/** The draft body — the prompting question (if any) above the reviewer-validated answer. */
function draftContent(question: string | null, answer: string): string {
  const q = question?.trim();
  return q ? `${q}\n\n${answer}` : answer;
}
