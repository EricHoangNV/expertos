import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { ReviewConfigDto, ReviewConfigUpdateInput } from "@expertos/shared";
import type { Prisma } from "@expertos/db";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { AdminAuditService } from "../admin/admin-audit.service";
import { CONCIERGE_ALLOW_SILENT } from "./concierge.tokens";

/** Prisma `select` that yields exactly the persisted columns of a {@link ReviewConfigDto}. */
const CONFIG_SELECT = {
  id: true,
  enabled: true,
  triggerMode: true,
  confidenceThreshold: true,
  slaHours: true,
  volumeCapPerDay: true,
  updatedAt: true,
} satisfies Prisma.ReviewConfigSelect;

/** The row shape {@link CONFIG_SELECT} returns. */
interface ConfigRow {
  id: string;
  enabled: boolean;
  triggerMode: ReviewConfigDto["triggerMode"];
  confidenceThreshold: number;
  slaHours: number;
  volumeCapPerDay: number;
  updatedAt: Date;
}

/** The launch-default config returned when no row has been seeded yet (mirrors the DB defaults: Off). */
const DEFAULT_CONFIG = {
  enabled: false,
  triggerMode: "user_prompted",
  confidenceThreshold: 0.5,
  slaHours: 24,
  volumeCapPerDay: 50,
} as const;

/**
 * The admin concierge trigger-config editor (M9.1, PRD §"Concierge Mode" → "Admin-configurable
 * trigger mode"). The single **write** choke point over the `review_configs` global singleton — the
 * human-review safety net (Off / Mode A user-prompted / Mode B auto-silent), its confidence threshold,
 * SLA, and daily volume cap become admin-tunable with **no deploy**.
 *
 * `review_configs` is global **RLS-exempt config** (like `recommendation_rules`), so a change is
 * platform-wide. Work still runs inside {@link RlsService.run} for the transaction + the admin GUC,
 * consistent with the other admin services; the `@Roles("admin")` route guard gates the caller. Every
 * mutation appends an immutable {@link AdminAuditService} entry in the same transaction.
 *
 * **OD#5 gate:** enabling **Mode B** (`auto_silent`) — a human silently editing an answer attributed to
 * a named expert — is the highest-liability mechanism in the app and is blocked until the legal/brand
 * sign-off flips the {@link CONCIERGE_ALLOW_SILENT} flag. The flag is also surfaced on the DTO
 * (`silentReviewAllowed`) so the UI can disable the option and explain why.
 */
@Injectable()
export class ConciergeConfigService {
  constructor(
    private readonly rls: RlsService,
    private readonly audit: AdminAuditService,
    @Inject(CONCIERGE_ALLOW_SILENT) private readonly silentReviewAllowed: boolean,
  ) {}

  /** The current concierge trigger config (the singleton row, or launch defaults if unseeded). */
  async getConfig(user: AuthUser): Promise<ReviewConfigDto> {
    return this.rls.run(user, async (tx) => {
      const row = (await tx.reviewConfig.findFirst({ select: CONFIG_SELECT })) as ConfigRow | null;
      return row ? this.toDto(row) : this.defaultDto();
    });
  }

  /**
   * Save the concierge trigger config. Rejects enabling Mode B until the OD#5 sign-off (→400), then
   * upserts the singleton (update the existing row, or create it if the DB was never seeded) and
   * records an audit entry in the same transaction.
   */
  async updateConfig(actor: AuthUser, input: ReviewConfigUpdateInput): Promise<ReviewConfigDto> {
    if (input.enabled && input.triggerMode === "auto_silent" && !this.silentReviewAllowed) {
      throw new BadRequestException(
        "Silent review (Mode B) is pending legal/brand sign-off and cannot be enabled yet",
      );
    }

    return this.rls.run(actor, async (tx) => {
      const data = {
        enabled: input.enabled,
        triggerMode: input.triggerMode,
        confidenceThreshold: input.confidenceThreshold,
        slaHours: input.slaHours,
        volumeCapPerDay: input.volumeCapPerDay,
      };

      const existing = await tx.reviewConfig.findFirst({ select: { id: true } });
      const row = (await (existing
        ? tx.reviewConfig.update({ where: { id: existing.id }, data, select: CONFIG_SELECT })
        : tx.reviewConfig.create({ data, select: CONFIG_SELECT }))) as ConfigRow;

      await this.audit.record(tx, actor, {
        action: "concierge.config_updated",
        targetType: "review_config",
        targetId: row.id,
        metadata: {
          enabled: row.enabled,
          triggerMode: row.triggerMode,
          confidenceThreshold: row.confidenceThreshold,
          slaHours: row.slaHours,
          volumeCapPerDay: row.volumeCapPerDay,
        },
      });

      return this.toDto(row);
    });
  }

  /** A persisted row → the wire DTO, stamping the runtime Mode-B allow-flag. */
  private toDto(row: ConfigRow): ReviewConfigDto {
    return {
      enabled: row.enabled,
      triggerMode: row.triggerMode,
      confidenceThreshold: row.confidenceThreshold,
      slaHours: row.slaHours,
      volumeCapPerDay: row.volumeCapPerDay,
      silentReviewAllowed: this.silentReviewAllowed,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** The launch defaults (Off) for a DB that hasn't been seeded; `updatedAt` is null (never saved). */
  private defaultDto(): ReviewConfigDto {
    return {
      ...DEFAULT_CONFIG,
      silentReviewAllowed: this.silentReviewAllowed,
      updatedAt: null,
    };
  }
}
