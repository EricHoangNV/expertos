import { Inject, Injectable } from "@nestjs/common";
import {
  chatModelSchema,
  type AppSettingsDto,
  type AppSettingsUpdateInput,
  type ChatModelValue,
} from "@expertos/shared";
import type { Prisma, PrismaClient } from "@expertos/db";
import { PRISMA } from "../database/database.module";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { AdminAuditService } from "../admin/admin-audit.service";
import { SETTINGS_EMBEDDING_PROVIDER_NAME } from "./settings.tokens";

/** Prisma `select` that yields exactly the persisted columns of an {@link AppSettingsDto}. */
const SETTINGS_SELECT = {
  id: true,
  llmTemperature: true,
  defaultChatModel: true,
  retrievalScoreFloor: true,
  updatedAt: true,
} satisfies Prisma.AppSettingsSelect;

/** The row shape {@link SETTINGS_SELECT} returns. */
interface SettingsRow {
  id: string;
  llmTemperature: number;
  defaultChatModel: string;
  retrievalScoreFloor: number;
  updatedAt: Date;
}

/** The launch-default settings returned when no row has been seeded yet (mirrors the DB defaults). */
const DEFAULT_SETTINGS = {
  llmTemperature: 0.2,
  defaultChatModel: "gpt-4o-mini",
  retrievalScoreFloor: 0,
} as const satisfies AppSettingsRuntime;

/**
 * The subset of {@link AppSettingsDto} the answer path reads per request — the tunable triple, with
 * `defaultChatModel` narrowed to the allowlist. No identity, timestamp, or read-only embedding field;
 * those are admin-UI concerns. {@link SettingsService.getCached} returns this.
 */
interface AppSettingsRuntime {
  llmTemperature: number;
  defaultChatModel: ChatModelValue;
  retrievalScoreFloor: number;
}

/** How long {@link SettingsService.getCached} serves a settings snapshot before re-reading the row. */
const CACHE_TTL_MS = 30_000;

/**
 * The admin runtime answer-tuning settings editor (M17.2, PRD §"M17 — Runtime answer-tuning
 * settings"). The single **write** choke point over the `app_settings` global singleton — LLM
 * temperature, the default chat model, and the retrieval relevance floor become admin-tunable with
 * **no deploy**.
 *
 * Clones the {@link ConciergeConfigService} pattern: `app_settings` is global **RLS-exempt config**,
 * so a change is platform-wide. Admin reads/writes still run inside {@link RlsService.run} (admin GUC +
 * transaction), consistent with the other admin services; the `@Roles("admin")` route guard gates the
 * caller. Every mutation appends an immutable {@link AdminAuditService} entry in the same transaction.
 *
 * The hot answer path ({@link ChatService}, {@link RetrievalService}) reads {@link getCached} instead —
 * a 30s in-process TTL snapshot read through the global `PrismaClient` (the row has no RLS), so a Save
 * takes effect on the next message with no restart and **no per-message DB hit**. {@link updateSettings}
 * busts the cache so a change is visible immediately to the saving admin's next turn too.
 */
@Injectable()
export class SettingsService {
  /** The last `getCached` snapshot + its expiry; null until the first read or after a bust. */
  private cached: { value: AppSettingsRuntime; expiresAt: number } | null = null;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly rls: RlsService,
    private readonly audit: AdminAuditService,
    @Inject(SETTINGS_EMBEDDING_PROVIDER_NAME) private readonly embeddingProvider: string,
  ) {}

  /** The current settings for the admin UI (the singleton row, or launch defaults if unseeded). */
  async getSettings(user: AuthUser): Promise<AppSettingsDto> {
    return this.rls.run(user, async (tx) => {
      const row = (await tx.appSettings.findFirst({ select: SETTINGS_SELECT })) as SettingsRow | null;
      return row ? this.toDto(row) : this.defaultDto();
    });
  }

  /**
   * Save the settings. Upserts the singleton (update the existing row, or create it if the DB was
   * never seeded), records an audit entry in the same transaction, then busts the runtime cache so the
   * change is live on the next answer.
   */
  async updateSettings(actor: AuthUser, input: AppSettingsUpdateInput): Promise<AppSettingsDto> {
    const dto = await this.rls.run(actor, async (tx) => {
      const data = {
        llmTemperature: input.llmTemperature,
        defaultChatModel: input.defaultChatModel,
        retrievalScoreFloor: input.retrievalScoreFloor,
      };

      const existing = await tx.appSettings.findFirst({ select: { id: true } });
      const row = (await (existing
        ? tx.appSettings.update({ where: { id: existing.id }, data, select: SETTINGS_SELECT })
        : tx.appSettings.create({ data, select: SETTINGS_SELECT }))) as SettingsRow;

      await this.audit.record(tx, actor, {
        action: "app_settings.updated",
        targetType: "app_settings",
        targetId: row.id,
        metadata: {
          llmTemperature: row.llmTemperature,
          defaultChatModel: row.defaultChatModel,
          retrievalScoreFloor: row.retrievalScoreFloor,
        },
      });

      return this.toDto(row);
    });

    this.cached = null;
    return dto;
  }

  /**
   * The runtime tuning triple for the answer path, served from a 30s in-process TTL cache. Reads the
   * `app_settings` singleton through the global `PrismaClient` (no RLS, so no per-user context needed);
   * falls back to {@link DEFAULT_SETTINGS} when the row is unseeded. Not a transaction — a single point
   * read on a global config row — so it stays cheap on the hot path.
   */
  async getCached(): Promise<AppSettingsRuntime> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) {
      return this.cached.value;
    }

    const row = (await this.prisma.appSettings.findFirst({
      select: SETTINGS_SELECT,
    })) as SettingsRow | null;
    const value = row ? this.toRuntime(row) : DEFAULT_SETTINGS;

    this.cached = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  }

  /** A persisted row → the runtime triple, narrowing `defaultChatModel` to the allowlist. */
  private toRuntime(row: SettingsRow): AppSettingsRuntime {
    return {
      llmTemperature: row.llmTemperature,
      defaultChatModel: this.normalizeModel(row.defaultChatModel),
      retrievalScoreFloor: row.retrievalScoreFloor,
    };
  }

  /** A persisted row → the admin-UI DTO, stamping the read-only env-driven embedding provider. */
  private toDto(row: SettingsRow): AppSettingsDto {
    return {
      ...this.toRuntime(row),
      embeddingProvider: this.embeddingProvider,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** The launch defaults for a DB that hasn't been seeded; `updatedAt` is null (never saved). */
  private defaultDto(): AppSettingsDto {
    return {
      ...DEFAULT_SETTINGS,
      embeddingProvider: this.embeddingProvider,
      updatedAt: null,
    };
  }

  /**
   * Narrow a stored model string to the {@link ChatModelValue} allowlist. `updateSettings` validates
   * on write, so a stored value is normally valid; a defensive fallback to the default keeps a
   * hand-edited/legacy row from leaking an unpriced model onto the answer path.
   */
  private normalizeModel(model: string): ChatModelValue {
    const parsed = chatModelSchema.safeParse(model);
    return parsed.success ? parsed.data : DEFAULT_SETTINGS.defaultChatModel;
  }
}
