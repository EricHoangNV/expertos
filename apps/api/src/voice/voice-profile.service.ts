import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@expertos/db";
import type {
  VoiceProfileCreateInput,
  VoiceProfileListQueryInput,
  VoiceProfileUpdateInput,
} from "@expertos/shared";
import type { RetrievalLanguage } from "@expertos/ai";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { StructuredLogger } from "../observability/logger.service";
import type { VoiceProfileSummary } from "./voice.types";

/** Prisma `select` that yields exactly a {@link VoiceProfileSummary} (plus the owning user). */
const PROFILE_SELECT = {
  id: true,
  expertId: true,
  language: true,
  name: true,
  description: true,
  guidelines: true,
  status: true,
  approvedBy: true,
  approvedAt: true,
  updatedAt: true,
  expert: { select: { displayName: true, userId: true } },
} satisfies Prisma.VoiceProfileSelect;

/** The row shape {@link PROFILE_SELECT} returns (kept explicit so tests can build fixtures). */
interface ProfileRow {
  id: string;
  expertId: string;
  language: string;
  name: string;
  description: string | null;
  guidelines: string | null;
  status: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  updatedAt: Date;
  expert: { displayName: string; userId: string | null };
}

/**
 * Expert voice-profile authoring + sign-off workflow (M2.3, PRD §"Expert voice layer").
 *
 * A voice profile moves through the shared publish lifecycle: an expert (or admin) authors a
 * `draft`, edits it while it stays a draft, submits it to `expert_review`, then *signs off* —
 * `approve` flips it to `published` and stamps `approvedBy`/`approvedAt`, which is the moment a
 * voice becomes eligible to render answers (see {@link PgVoiceExampleStore.loadProfile}, which
 * only loads `published` profiles). `requestChanges` returns a reviewed profile to `draft`.
 *
 * Profiles are language-specific, so each `(expert, language)` profile is signed off
 * independently — this is the EN + VI "language-aware voice" requirement.
 *
 * Authorization: tenant isolation is enforced structurally by Postgres RLS (directive §4.21) via
 * {@link RlsService}. On top of that, the *ownership* rule — "an expert signs off on their own
 * voice" (NT.2) — is enforced here: a non-admin actor may only touch a profile whose expert is
 * linked to their own user. Admins (the portal operators) may act across the tenant.
 */
@Injectable()
export class VoiceProfileService {
  constructor(
    private readonly rls: RlsService,
    private readonly logger: StructuredLogger,
  ) {}

  /** Author a new draft profile for an expert the actor owns (or any expert, for an admin). */
  async create(
    user: AuthUser,
    input: VoiceProfileCreateInput,
  ): Promise<VoiceProfileSummary> {
    return this.rls.run(user, async (tx) => {
      const expert = await tx.expert.findUnique({
        where: { id: input.expertId },
        select: { userId: true },
      });
      if (!expert) {
        throw new NotFoundException("expert not found");
      }
      this.assertOwnership(user, expert.userId);

      const row = (await tx.voiceProfile.create({
        data: {
          tenantId: user.tenantId,
          expertId: input.expertId,
          language: input.language,
          name: input.name,
          description: input.description ?? null,
          guidelines: input.guidelines ?? null,
          status: "draft",
        },
        select: PROFILE_SELECT,
      })) as ProfileRow;

      this.logger.info("voice profile created", {
        profileId: row.id,
        expertId: input.expertId,
        language: input.language,
      });
      return toSummary(row);
    });
  }

  /** Edit a draft profile's free-text fields. Allowed only while the profile is a draft. */
  async update(
    user: AuthUser,
    profileId: string,
    patch: VoiceProfileUpdateInput,
  ): Promise<VoiceProfileSummary> {
    return this.rls.run(user, async (tx) => {
      const current = await this.loadManageable(tx, user, profileId);
      if (current.status !== "draft") {
        throw new ConflictException("only a draft profile can be edited");
      }

      const data: Prisma.VoiceProfileUpdateInput = {};
      if (patch.name !== undefined) {
        data.name = patch.name;
      }
      if (patch.description !== undefined) {
        data.description = patch.description === "" ? null : patch.description;
      }
      if (patch.guidelines !== undefined) {
        data.guidelines = patch.guidelines === "" ? null : patch.guidelines;
      }

      const row = (await tx.voiceProfile.update({
        where: { id: profileId },
        data,
        select: PROFILE_SELECT,
      })) as ProfileRow;

      this.logger.info("voice profile updated", { profileId });
      return toSummary(row);
    });
  }

  /** Submit a draft for expert review (`draft` → `expert_review`). */
  submit(user: AuthUser, profileId: string): Promise<VoiceProfileSummary> {
    return this.transition(user, profileId, {
      from: "draft",
      to: "expert_review",
      event: "voice profile submitted for review",
    });
  }

  /** Sign off on a reviewed profile, publishing it (`expert_review` → `published`). */
  approve(user: AuthUser, profileId: string): Promise<VoiceProfileSummary> {
    return this.transition(user, profileId, {
      from: "expert_review",
      to: "published",
      event: "voice profile approved",
      stampApproval: true,
    });
  }

  /** Return a reviewed profile to the author for changes (`expert_review` → `draft`). */
  requestChanges(user: AuthUser, profileId: string): Promise<VoiceProfileSummary> {
    return this.transition(user, profileId, {
      from: "expert_review",
      to: "draft",
      event: "voice profile changes requested",
    });
  }

  /**
   * List profiles in the sign-off workflow. An expert sees only their own profiles; an admin
   * sees every profile in the tenant. `status`/`expertId`/`language` narrow the result.
   */
  async list(
    user: AuthUser,
    query: VoiceProfileListQueryInput,
  ): Promise<VoiceProfileSummary[]> {
    const rows = await this.rls.run(user, async (tx) => {
      const where: Prisma.VoiceProfileWhereInput = {};
      if (query.status) {
        where.status = query.status;
      }
      if (query.expertId) {
        where.expertId = query.expertId;
      }
      if (query.language) {
        where.language = query.language;
      }
      // RLS scopes to the tenant; restrict a non-admin actor to their own expert's profiles.
      if (user.role !== "admin") {
        where.expert = { userId: user.id };
      }
      return (await tx.voiceProfile.findMany({
        where,
        select: PROFILE_SELECT,
        orderBy: { updatedAt: "desc" },
        take: query.limit,
      })) as ProfileRow[];
    });

    this.logger.info("voice profile list completed", {
      status: query.status ?? "any",
      count: rows.length,
    });
    return rows.map(toSummary);
  }

  /** Shared state-machine step: assert the current status, then move + stamp + log. */
  private async transition(
    user: AuthUser,
    profileId: string,
    spec: {
      from: string;
      to: "draft" | "expert_review" | "published";
      event: string;
      stampApproval?: boolean;
    },
  ): Promise<VoiceProfileSummary> {
    return this.rls.run(user, async (tx) => {
      const current = await this.loadManageable(tx, user, profileId);
      if (current.status !== spec.from) {
        throw new ConflictException(
          `cannot ${spec.to === "published" ? "approve" : "transition"} a ${current.status} profile`,
        );
      }

      const data: Prisma.VoiceProfileUpdateInput = { status: spec.to };
      if (spec.stampApproval) {
        data.approvedBy = user.id;
        data.approvedAt = new Date();
      }

      const row = (await tx.voiceProfile.update({
        where: { id: profileId },
        data,
        select: PROFILE_SELECT,
      })) as ProfileRow;

      this.logger.info(spec.event, { profileId, status: spec.to });
      return toSummary(row);
    });
  }

  /** Load a profile and assert the actor may manage it (exists + tenant + ownership). */
  private async loadManageable(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    profileId: string,
  ): Promise<ProfileRow> {
    const row = (await tx.voiceProfile.findUnique({
      where: { id: profileId },
      select: PROFILE_SELECT,
    })) as ProfileRow | null;
    if (!row) {
      throw new NotFoundException("voice profile not found");
    }
    this.assertOwnership(user, row.expert.userId);
    return row;
  }

  /** An admin may manage any profile; an expert only their own expert's. */
  private assertOwnership(user: AuthUser, expertUserId: string | null): void {
    if (user.role === "admin") {
      return;
    }
    if (expertUserId !== null && expertUserId === user.id) {
      return;
    }
    throw new ForbiddenException("not your voice profile");
  }
}

/** Flatten a {@link PROFILE_SELECT} row into the public {@link VoiceProfileSummary}. */
function toSummary(row: ProfileRow): VoiceProfileSummary {
  return {
    id: row.id,
    expertId: row.expertId,
    expertName: row.expert.displayName,
    language: row.language as RetrievalLanguage,
    name: row.name,
    description: row.description,
    guidelines: row.guidelines,
    status: row.status as VoiceProfileSummary["status"],
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    updatedAt: row.updatedAt,
  };
}
