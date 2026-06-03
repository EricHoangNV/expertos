import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@expertos/db";
import type {
  AllowedEmailCreateInput,
  AllowedEmailDto,
  AllowedEmailUpdateInput,
} from "@expertos/shared";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { StructuredLogger } from "../observability/logger.service";
import { AdminAuditService } from "./admin-audit.service";

/** `select` that yields exactly an {@link AllowedEmailDto} (plus the resolved adder email). */
const DTO_SELECT = {
  id: true,
  email: true,
  role: true,
  createdAt: true,
  creator: { select: { email: true } },
} satisfies Prisma.AllowedEmailSelect;

/** The row shape {@link DTO_SELECT} returns. */
interface AllowedEmailRow {
  id: string;
  email: string;
  role: "user" | "expert" | "admin";
  createdAt: Date;
  creator: { email: string } | null;
}

/**
 * Admin-portal whitelist management (M14, PRD-access-control §6.2–6.5). The invite list of who may
 * sign into the admin portal and with what role; {@link AdminSessionService} is what reads it at
 * sign-in. Built on the {@link AdminExpertService} template: every read/write runs inside
 * {@link RlsService.run} under the admin principal (the `is_admin` GUC → platform-wide visibility),
 * the `@Roles("admin")` route guard gates the caller, and every **mutation** appends an immutable
 * {@link AdminAuditService} entry **in the same transaction**.
 *
 * Self-lockout protection (PRD §6.4/§6.5): an admin cannot demote or remove their *own* whitelist
 * entry, so they can't accidentally lock themselves (and possibly everyone) out of the portal.
 */
@Injectable()
export class AccessControlService {
  constructor(
    private readonly rls: RlsService,
    private readonly audit: AdminAuditService,
    private readonly logger: StructuredLogger,
  ) {}

  /** The whitelist, newest first. */
  async list(user: AuthUser): Promise<AllowedEmailDto[]> {
    return this.rls.run(user, async (tx) => {
      const rows = (await tx.allowedEmail.findMany({
        orderBy: { createdAt: "desc" },
        select: DTO_SELECT,
      })) as AllowedEmailRow[];
      return rows.map(toDto);
    });
  }

  /** Add an email to the whitelist (409 if it already exists). */
  async add(actor: AuthUser, input: AllowedEmailCreateInput): Promise<AllowedEmailDto> {
    return this.rls.run(actor, async (tx) => {
      let row: AllowedEmailRow;
      try {
        row = (await tx.allowedEmail.create({
          data: {
            tenantId: actor.tenantId,
            email: input.email,
            role: input.role,
            createdBy: actor.id,
          },
          select: DTO_SELECT,
        })) as AllowedEmailRow;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new ConflictException("This email is already on the whitelist");
        }
        throw err;
      }
      await this.audit.record(tx, actor, {
        action: "access_control.email_added",
        targetType: "allowed_email",
        targetId: row.id,
        metadata: { email: input.email, role: input.role },
      });
      this.logger.info("allowed email added", { id: row.id, role: input.role });
      return toDto(row);
    });
  }

  /** Change a whitelist entry's role. Rejects demoting your own admin access (self-lockout). */
  async updateRole(
    actor: AuthUser,
    id: string,
    input: AllowedEmailUpdateInput,
  ): Promise<AllowedEmailDto> {
    return this.rls.run(actor, async (tx) => {
      const current = (await tx.allowedEmail.findUnique({
        where: { id },
        select: { email: true, role: true },
      })) as { email: string; role: "user" | "expert" | "admin" } | null;
      if (!current) {
        throw new NotFoundException("whitelist entry not found");
      }
      // Self-lockout: an admin may not demote their own entry below admin (PRD §6.4).
      if (current.email === actor.email.toLowerCase() && input.role !== "admin") {
        throw new BadRequestException("You cannot demote your own admin access");
      }
      const row = (await tx.allowedEmail.update({
        where: { id },
        data: { role: input.role },
        select: DTO_SELECT,
      })) as AllowedEmailRow;
      // Source-of-truth sync: mirror the new role onto the user row so a demotion revokes the
      // stale privilege on the *next* API request, not just at the next portal sign-in (security
      // FAIL: RolesGuard reads users.role, which AdminSessionService only synced at sign-in).
      await this.syncUserRole(tx, current.email, input.role);
      await this.audit.record(tx, actor, {
        action: "access_control.role_changed",
        targetType: "allowed_email",
        targetId: id,
        metadata: { email: current.email, from: current.role, to: input.role },
      });
      this.logger.info("allowed email role changed", { id, from: current.role, to: input.role });
      return toDto(row);
    });
  }

  /** Remove an email from the whitelist. Rejects removing your own entry (self-lockout). */
  async remove(actor: AuthUser, id: string): Promise<{ ok: true }> {
    return this.rls.run(actor, async (tx) => {
      const current = (await tx.allowedEmail.findUnique({
        where: { id },
        select: { email: true, role: true },
      })) as { email: string; role: "user" | "expert" | "admin" } | null;
      if (!current) {
        throw new NotFoundException("whitelist entry not found");
      }
      // Self-lockout: an admin may not remove their own entry (PRD §6.5).
      if (current.email === actor.email.toLowerCase()) {
        throw new BadRequestException("You cannot remove your own access");
      }
      await tx.allowedEmail.delete({ where: { id } });
      // Source-of-truth sync: drop the user back to the base `user` role so a removed admin/expert
      // loses privileged-API access immediately (RolesGuard reads users.role) rather than only
      // being blocked at the portal sign-in gate. See {@link syncUserRole}.
      await this.syncUserRole(tx, current.email, "user");
      await this.audit.record(tx, actor, {
        action: "access_control.email_removed",
        targetType: "allowed_email",
        targetId: id,
        metadata: { email: current.email, role: current.role },
      });
      this.logger.info("allowed email removed", { id });
      return { ok: true };
    });
  }

  /**
   * Mirror a whitelist change onto the matching user row(s). The privileged API boundary
   * ({@link RolesGuard}) authorizes from `users.role`, which {@link AdminSessionService} previously
   * only synced at portal sign-in — so a removed/demoted operator kept their stale role until they
   * re-signed-in and could keep calling `@Roles` APIs directly. Writing through here makes the
   * whitelist the source of truth for the API, not just the UI. Email match is case-insensitive
   * (the whitelist normalizes to lowercase; the mirrored `users.email` comes verbatim from Firebase)
   * and uses `updateMany`, so it is a no-op when the invitee has never signed in (no user row yet).
   */
  private async syncUserRole(
    tx: Prisma.TransactionClient,
    email: string,
    role: "user" | "expert" | "admin",
  ): Promise<void> {
    await tx.user.updateMany({
      where: { email: { equals: email, mode: "insensitive" } },
      data: { role },
    });
  }
}

/** Flatten a {@link DTO_SELECT} row into {@link AllowedEmailDto}. */
function toDto(row: AllowedEmailRow): AllowedEmailDto {
  return {
    id: row.id,
    email: row.email,
    // The whitelist only ever stores the two portal roles (enforced at the app layer on write).
    role: row.role === "admin" ? "admin" : "expert",
    createdAt: row.createdAt.toISOString(),
    createdByEmail: row.creator?.email ?? null,
  };
}
