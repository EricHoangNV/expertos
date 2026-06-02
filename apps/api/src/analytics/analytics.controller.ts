import { Controller, Get, Query } from "@nestjs/common";
import {
  usageAnalyticsQuerySchema,
  funnelAnalyticsQuerySchema,
  conciergeAnalyticsQuerySchema,
  validationAnalyticsQuerySchema,
  questionsAnalyticsQuerySchema,
  type CacheAnalyticsDto,
  type ConciergeAnalyticsDto,
  type ConciergeAnalyticsQueryInput,
  type FunnelAnalyticsDto,
  type FunnelAnalyticsQueryInput,
  type KnowledgePipelineDto,
  type QuestionsAnalyticsDto,
  type QuestionsAnalyticsQueryInput,
  type UsageAnalyticsDto,
  type UsageAnalyticsQueryInput,
  type ValidationAnalyticsDto,
  type ValidationAnalyticsQueryInput,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ResponseCacheService } from "../cache/response-cache.service";
import { AnalyticsService } from "./analytics.service";

/**
 * Admin usage & cost analytics API (M10.1). Admin-only (`@Roles("admin")`); the report is
 * platform-wide across all tenants — the admin RLS context inside {@link AnalyticsService} grants the
 * cross-tenant read. All branchy logic lives in the service (the coverage gate collects
 * `*.service.ts`); this controller only validates the query and delegates.
 */
@Controller("admin/analytics")
@Roles("admin")
export class AnalyticsController {
  constructor(
    private readonly service: AnalyticsService,
    private readonly responseCache: ResponseCacheService,
  ) {}

  /** Usage & cost totals + per-feature/per-model breakdown + a trailing daily series. */
  @Get("usage")
  usage(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(usageAnalyticsQuerySchema))
    query: UsageAnalyticsQueryInput,
  ): Promise<UsageAnalyticsDto> {
    return this.service.usage(user, query);
  }

  /** Consultation funnel + attribution: conversations → recommendations → bookings → revenue (M10.2). */
  @Get("funnel")
  funnel(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(funnelAnalyticsQuerySchema))
    query: FunnelAnalyticsQueryInput,
  ): Promise<FunnelAnalyticsDto> {
    return this.service.funnel(user, query);
  }

  /** Concierge ops: volume (by status/mode/visibility) + SLA + verdicts + knowledge-quality (M10.3). */
  @Get("concierge")
  concierge(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(conciergeAnalyticsQuerySchema))
    query: ConciergeAnalyticsQueryInput,
  ): Promise<ConciergeAnalyticsDto> {
    return this.service.concierge(user, query);
  }

  /** Validation scorecard: activation + engagement + willingness-to-pay + funnel conversion (M10.4). */
  @Get("validation")
  validation(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(validationAnalyticsQuerySchema))
    query: ValidationAnalyticsQueryInput,
  ): Promise<ValidationAnalyticsDto> {
    return this.service.validation(user, query);
  }

  /** Questions answered, partitioned grounded / low-confidence / insufficient + a daily series (M13.2.3). */
  @Get("questions")
  questions(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(questionsAnalyticsQuerySchema))
    query: QuestionsAnalyticsQueryInput,
  ): Promise<QuestionsAnalyticsDto> {
    return this.service.questions(user, query);
  }

  /** Knowledge documents grouped by publish-lifecycle stage — a live pipeline snapshot (M13.2.6). */
  @Get("knowledge-pipeline")
  knowledgePipeline(@CurrentUser() user: AuthUser): Promise<KnowledgePipelineDto> {
    return this.service.knowledgePipeline(user);
  }

  /**
   * Cache effectiveness across the three M6.4 layers (retrieval / answer-memory / semantic) — the
   * observability the M11.3 caching tuning turns on. A pure in-process snapshot ({@link
   * ResponseCacheService.stats}), so unlike the other reports it takes no window and does no DB read;
   * it is **per-instance** (the caches are in-process). Delegated straight to the cache choke point —
   * no branchy logic to land in the service.
   */
  @Get("cache")
  cache(): CacheAnalyticsDto {
    return this.responseCache.stats();
  }
}
