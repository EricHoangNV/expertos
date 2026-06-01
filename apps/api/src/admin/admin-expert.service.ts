import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@expertos/db";
import type {
  AdminExpertActiveUpdateInput,
  AdminExpertCreateInput,
  AdminExpertDetailDto,
  AdminExpertListQueryInput,
  AdminExpertSummaryDto,
  AdminExpertUpdateInput,
} from "@expertos/shared";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { StructuredLogger } from "../observability/logger.service";
import { AdminAuditService } from "./admin-audit.service";

/** `select` for the management list row → {@link AdminExpertSummaryDto}. */
const SUMMARY_SELECT = {
  id: true,
  slug: true,
  displayName: true,
  title: true,
  active: true,
  createdAt: true,
  _count: { select: { voiceProfiles: true } },
} satisfies Prisma.ExpertSelect;

interface SummaryRow {
  id: string;
  slug: string;
  displayName: string;
  title: string | null;
  active: boolean;
  createdAt: Date;
  _count: { voiceProfiles: number };
}

/** `select` for the detail view → {@link AdminExpertDetailDto}. */
const DETAIL_SELECT = {
  id: true,
  slug: true,
  displayName: true,
  title: true,
  bio: true,
  active: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { email: true } },
  _count: { select: { voiceProfiles: true, documents: true } },
} satisfies Prisma.ExpertSelect;

interface DetailRow {
  id: string;
  slug: string;
  displayName: string;
  title: string | null;
  bio: string | null;
  active: boolean;
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: { email: string } | null;
  _count: { voiceProfiles: number; documents: number };
}

/**
 * Admin expert-roster management (M8.4, PRD §"Admin web portal" → "Manage … experts"). An expert
 * (the `experts` row) is the identity a {@link VoiceProfileService voice profile} (M2.3) and
 * published knowledge (M8.1) hang off; there is no self-service path to create one, so this is the
 * only authoring surface. Built on the {@link AdminUserService} template: every read/write runs
 * inside {@link RlsService.run} under the admin principal (the `is_admin` GUC → platform-wide,
 * cross-tenant visibility), the `@Roles("admin")` route guard gates the caller, and every
 * **mutation** appends an immutable {@link AdminAuditService} entry **in the same transaction** so
 * an action and its audit record commit (or roll back) atomically.
 *
 * The `slug` is the stable identity and is frozen after creation (it can be referenced elsewhere),
 * so only create accepts it. `userId` optionally links an *operator* account; it is nullable, so an
 * expert can outlive a deleted operator (FK `SetNull`) and an admin can re-point or unlink it. A
 * duplicate slug or a doubly-linked operator surfaces as a `409` (the unique constraints).
 */
@Injectable()
export class AdminExpertService {
  constructor(
    private readonly rls: RlsService,
    private readonly audit: AdminAuditService,
    private readonly logger: StructuredLogger,
  ) {}

  /** A page of experts, newest first; optionally narrowed by active state and/or a slug/name search. */
  async list(user: AuthUser, query: AdminExpertListQueryInput): Promise<AdminExpertSummaryDto[]> {
    return this.rls.run(user, async (tx) => {
      const where: Prisma.ExpertWhereInput = {};
      if (query.active !== undefined) {
        where.active = query.active;
      }
      if (query.search) {
        where.OR = [
          { slug: { contains: query.search, mode: "insensitive" } },
          { displayName: { contains: query.search, mode: "insensitive" } },
        ];
      }
      const rows = (await tx.expert.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: query.limit,
        skip: query.offset,
        select: SUMMARY_SELECT,
      })) as SummaryRow[];
      return rows.map(toSummary);
    });
  }

  /** One expert's full detail: identity, operator link, and content counts. */
  async get(user: AuthUser, expertId: string): Promise<AdminExpertDetailDto> {
    return this.rls.run(user, async (tx) => {
      const row = (await tx.expert.findUnique({
        where: { id: expertId },
        select: DETAIL_SELECT,
      })) as DetailRow | null;
      if (!row) {
        throw new NotFoundException("expert not found");
      }
      return toDetail(row);
    });
  }

  /** Author a new expert (optionally linking an operator account). */
  async create(actor: AuthUser, input: AdminExpertCreateInput): Promise<AdminExpertDetailDto> {
    return this.rls.run(actor, async (tx) => {
      if (input.userId) {
        await this.assertUserExists(tx, input.userId);
      }
      let row: DetailRow;
      try {
        row = (await tx.expert.create({
          data: {
            tenantId: actor.tenantId,
            slug: input.slug,
            displayName: input.displayName,
            title: input.title ?? null,
            bio: input.bio ?? null,
            userId: input.userId ?? null,
          },
          select: DETAIL_SELECT,
        })) as DetailRow;
      } catch (err) {
        rethrowUniqueViolation(err);
      }
      await this.audit.record(tx, actor, {
        action: "expert.created",
        targetType: "expert",
        targetId: row.id,
        metadata: { slug: input.slug, linkedUserId: input.userId ?? null },
      });
      this.logger.info("expert created", { expertId: row.id, slug: input.slug });
      return toDetail(row);
    });
  }

  /** Edit an expert's free-text fields and/or operator link (slug is immutable). */
  async update(
    actor: AuthUser,
    expertId: string,
    patch: AdminExpertUpdateInput,
  ): Promise<AdminExpertDetailDto> {
    return this.rls.run(actor, async (tx) => {
      const current = await tx.expert.findUnique({
        where: { id: expertId },
        select: { id: true },
      });
      if (!current) {
        throw new NotFoundException("expert not found");
      }
      if (patch.userId) {
        await this.assertUserExists(tx, patch.userId);
      }

      const data: Prisma.ExpertUpdateInput = {};
      if (patch.displayName !== undefined) {
        data.displayName = patch.displayName;
      }
      if (patch.title !== undefined) {
        data.title = patch.title === "" ? null : patch.title;
      }
      if (patch.bio !== undefined) {
        data.bio = patch.bio === "" ? null : patch.bio;
      }
      if (patch.userId !== undefined) {
        data.user = patch.userId === null ? { disconnect: true } : { connect: { id: patch.userId } };
      }

      let row: DetailRow;
      try {
        row = (await tx.expert.update({
          where: { id: expertId },
          data,
          select: DETAIL_SELECT,
        })) as DetailRow;
      } catch (err) {
        rethrowUniqueViolation(err);
      }
      await this.audit.record(tx, actor, {
        action: "expert.updated",
        targetType: "expert",
        targetId: expertId,
        metadata: { fields: Object.keys(data) },
      });
      this.logger.info("expert updated", { expertId });
      return toDetail(row);
    });
  }

  /** Activate / deactivate an expert (an inactive expert's voices drop out of the picker). */
  async setActive(
    actor: AuthUser,
    expertId: string,
    input: AdminExpertActiveUpdateInput,
  ): Promise<AdminExpertDetailDto> {
    return this.rls.run(actor, async (tx) => {
      const current = await tx.expert.findUnique({
        where: { id: expertId },
        select: { active: true },
      });
      if (!current) {
        throw new NotFoundException("expert not found");
      }
      const row = (await tx.expert.update({
        where: { id: expertId },
        data: { active: input.active },
        select: DETAIL_SELECT,
      })) as DetailRow;
      await this.audit.record(tx, actor, {
        action: input.active ? "expert.activated" : "expert.deactivated",
        targetType: "expert",
        targetId: expertId,
      });
      this.logger.info("expert active state changed", { expertId, active: input.active });
      return toDetail(row);
    });
  }

  /** Assert a to-be-linked operator account exists (a 404 instead of an opaque FK error). */
  private async assertUserExists(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      throw new NotFoundException("linked user not found");
    }
  }
}

/** Map a Postgres unique-constraint violation (slug or operator link) to a 409. */
function rethrowUniqueViolation(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new ConflictException("an expert with this slug or linked user already exists");
  }
  throw err;
}

/** Flatten a {@link SUMMARY_SELECT} row into {@link AdminExpertSummaryDto}. */
function toSummary(row: SummaryRow): AdminExpertSummaryDto {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    title: row.title,
    active: row.active,
    voiceProfileCount: row._count.voiceProfiles,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Flatten a {@link DETAIL_SELECT} row into {@link AdminExpertDetailDto}. */
function toDetail(row: DetailRow): AdminExpertDetailDto {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    title: row.title,
    bio: row.bio,
    active: row.active,
    userId: row.userId,
    linkedUserEmail: row.user?.email ?? null,
    voiceProfileCount: row._count.voiceProfiles,
    documentCount: row._count.documents,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
