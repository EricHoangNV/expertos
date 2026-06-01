import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@expertos/db";
import type {
  KnowledgeDraftCreateInput,
  KnowledgeDraftDto,
  KnowledgeDraftListQueryInput,
  KnowledgeDraftStatusValue,
  KnowledgeDraftSummaryDto,
  KnowledgeDraftUpdateInput,
  LanguageValue,
} from "@expertos/shared";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { StructuredLogger } from "../observability/logger.service";
import { EmptyDocumentError, IngestionService } from "../ingestion/ingestion.service";

/** The full draft row shape this service reads/maps. */
interface DraftRow {
  id: string;
  title: string;
  content: string;
  language: string;
  status: string;
  conversationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Published drafts are ingested into the expert's global knowledge base. */
const PUBLISH_SCOPE = "global_expert" as const;

/**
 * Conversation-to-knowledge pipeline (M8.2, PRD §"Admin & Expert portals").
 *
 * Captures a valuable chat answer as a `knowledge_drafts` row and drives it through its own
 * review lifecycle, mirroring the M8.1 document gate but for free-text drafts promoted from
 * conversations:
 *
 *   `draft → expert_review → published`   (`request-changes` returns it to `draft`)
 *   `draft | expert_review → rejected`    (discard)
 *
 * {@link publish} is the gate that makes a draft live: it runs the draft's text through the
 * M1.1 ingestion pipeline ({@link IngestionService}) with `publish:true`, creating a fresh
 * published `document` (+ retrieval-visible chunks). Each draft maps to a unique source URI
 * (`draft://<id>`), so a republish never appends a second generation to the same document —
 * and the publish step is idempotent (it skips ingestion when that document already exists,
 * so a crash between ingest and the status flip can be retried without drift).
 *
 * Authorization: tenant isolation is enforced structurally by Postgres RLS via
 * {@link RlsService}; the controller gates every route at the `expert` role (admin satisfies
 * it via the role hierarchy). `knowledge_drafts` is tenant-scoped (no per-expert ownership),
 * the same model as M8.1 knowledge.
 */
@Injectable()
export class KnowledgeDraftService {
  constructor(
    private readonly rls: RlsService,
    private readonly ingestion: IngestionService,
    private readonly logger: StructuredLogger,
  ) {}

  /** "Mark valuable": capture a new draft (optionally tied to its source conversation). */
  async create(user: AuthUser, input: KnowledgeDraftCreateInput): Promise<KnowledgeDraftDto> {
    const row = await this.rls.run(user, async (tx) => {
      if (input.conversationId) {
        // RLS makes a conversation the actor cannot see invisible → a forged/foreign id 404s.
        const conversation = await tx.conversation.findUnique({
          where: { id: input.conversationId },
          select: { id: true },
        });
        if (!conversation) {
          throw new NotFoundException("conversation not found");
        }
      }
      return (await tx.knowledgeDraft.create({
        data: {
          tenantId: user.tenantId,
          title: input.title,
          content: input.content,
          language: input.language,
          conversationId: input.conversationId ?? null,
          status: "draft",
        },
      })) as DraftRow;
    });

    this.logger.info("knowledge draft created", {
      draftId: row.id,
      fromConversation: row.conversationId !== null,
    });
    return toDraftDto(row);
  }

  /** The draft review queue (filter by status), newest activity first. */
  async list(
    user: AuthUser,
    query: KnowledgeDraftListQueryInput,
  ): Promise<KnowledgeDraftSummaryDto[]> {
    const rows = await this.rls.run(user, async (tx) => {
      const where: Prisma.KnowledgeDraftWhereInput = {};
      if (query.status) {
        where.status = query.status;
      }
      return (await tx.knowledgeDraft.findMany({
        where,
        select: SUMMARY_SELECT,
        orderBy: { updatedAt: "desc" },
        take: query.limit,
      })) as Omit<DraftRow, "content">[];
    });

    this.logger.info("knowledge draft list completed", {
      status: query.status ?? "any",
      count: rows.length,
    });
    return rows.map(toSummaryDto);
  }

  /** A single draft with its full content. */
  async get(user: AuthUser, draftId: string): Promise<KnowledgeDraftDto> {
    const row = await this.rls.run(user, (tx) => this.load(tx, draftId));
    return toDraftDto(row);
  }

  /** Edit a draft's title/content — allowed only while it is still `draft`. */
  async update(
    user: AuthUser,
    draftId: string,
    input: KnowledgeDraftUpdateInput,
  ): Promise<KnowledgeDraftDto> {
    const row = await this.rls.run(user, async (tx) => {
      const draft = await this.load(tx, draftId);
      if (draft.status !== "draft") {
        throw new ConflictException(`cannot edit a ${draft.status} draft`);
      }
      return (await tx.knowledgeDraft.update({
        where: { id: draftId },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.content !== undefined ? { content: input.content } : {}),
        },
      })) as DraftRow;
    });
    this.logger.info("knowledge draft updated", { draftId });
    return toDraftDto(row);
  }

  /** Submit a draft for expert review (`draft` → `expert_review`). */
  submit(user: AuthUser, draftId: string): Promise<KnowledgeDraftDto> {
    return this.transition(user, draftId, {
      from: ["draft"],
      to: "expert_review",
      event: "knowledge draft submitted for review",
    });
  }

  /** Return a draft to its author for changes (`expert_review` → `draft`). */
  requestChanges(user: AuthUser, draftId: string): Promise<KnowledgeDraftDto> {
    return this.transition(user, draftId, {
      from: ["expert_review"],
      to: "draft",
      event: "knowledge draft changes requested",
    });
  }

  /** Discard a draft (`draft | expert_review` → `rejected`). */
  reject(user: AuthUser, draftId: string): Promise<KnowledgeDraftDto> {
    return this.transition(user, draftId, {
      from: ["draft", "expert_review"],
      to: "rejected",
      event: "knowledge draft rejected",
    });
  }

  /**
   * Sign off on a reviewed draft, publishing it (`expert_review` → `published`). This is the
   * gate: it ingests the draft's text into the knowledge base (M1.1 pipeline, `publish:true`)
   * as a fresh published document, then marks the draft published. Idempotent — re-running
   * after a partial failure skips re-ingestion (the `draft://<id>` document already exists).
   */
  async publish(user: AuthUser, draftId: string): Promise<KnowledgeDraftDto> {
    const sourceUri = `draft://${draftId}`;

    const { draft, alreadyIngested } = await this.rls.run(user, async (tx) => {
      const loaded = await this.load(tx, draftId);
      if (loaded.status !== "expert_review") {
        throw new ConflictException(`cannot publish a ${loaded.status} draft`);
      }
      const existing = await tx.document.findFirst({
        where: { tenantId: user.tenantId, scope: PUBLISH_SCOPE, sourceUri },
        select: { id: true },
      });
      return { draft: loaded, alreadyIngested: existing !== null };
    });

    if (!alreadyIngested) {
      try {
        await this.ingestion.ingest(
          user,
          {
            sourceUri,
            title: draft.title,
            contentType: "text/plain",
            scope: PUBLISH_SCOPE,
            language: draft.language,
            changeSummary: `Published from conversation-to-knowledge draft ${draftId}`,
          },
          draft.content,
          { publish: true },
        );
      } catch (error) {
        if (error instanceof EmptyDocumentError) {
          throw new BadRequestException("draft content has no indexable text");
        }
        throw error;
      }
    }

    const row = await this.rls.run(user, async (tx) =>
      (await tx.knowledgeDraft.update({
        where: { id: draftId },
        data: { status: "published" },
      })) as DraftRow,
    );

    this.logger.info("knowledge draft published", { draftId, reingested: !alreadyIngested });
    return toDraftDto(row);
  }

  /** Shared status move: assert the current status is allowed, update, log. */
  private async transition(
    user: AuthUser,
    draftId: string,
    spec: { from: string[]; to: KnowledgeDraftStatusValue; event: string },
  ): Promise<KnowledgeDraftDto> {
    const row = await this.rls.run(user, async (tx) => {
      const draft = await this.load(tx, draftId);
      if (!spec.from.includes(draft.status)) {
        throw new ConflictException(`cannot transition a ${draft.status} draft`);
      }
      return (await tx.knowledgeDraft.update({
        where: { id: draftId },
        data: { status: spec.to },
      })) as DraftRow;
    });
    this.logger.info(spec.event, { draftId, status: spec.to });
    return toDraftDto(row);
  }

  /** Load a draft row or 404. RLS makes a peer tenant's draft invisible (→ not found). */
  private async load(tx: Prisma.TransactionClient, draftId: string): Promise<DraftRow> {
    const row = (await tx.knowledgeDraft.findUnique({
      where: { id: draftId },
    })) as DraftRow | null;
    if (!row) {
      throw new NotFoundException("knowledge draft not found");
    }
    return row;
  }
}

/** `select` for the list view — every summary field, no body content. */
const SUMMARY_SELECT = {
  id: true,
  title: true,
  language: true,
  status: true,
  conversationId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.KnowledgeDraftSelect;

function toSummaryDto(row: Omit<DraftRow, "content">): KnowledgeDraftSummaryDto {
  return {
    id: row.id,
    title: row.title,
    status: row.status as KnowledgeDraftStatusValue,
    language: row.language as LanguageValue,
    conversationId: row.conversationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDraftDto(row: DraftRow): KnowledgeDraftDto {
  return { ...toSummaryDto(row), content: row.content };
}
