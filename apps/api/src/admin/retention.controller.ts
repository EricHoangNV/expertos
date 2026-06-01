import { Controller, Get, Post } from "@nestjs/common";
import type { RetentionPreviewDto, RetentionSweepResultDto } from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { RetentionService } from "./retention.service";

/**
 * Data-retention sweep API (NT.3). Admin-only (`@Roles("admin")`); operates platform-wide via the
 * admin RLS context inside {@link RetentionService}. `preview` is a non-destructive dry run; `sweep`
 * performs the deletions and is the route a Cloud Scheduler job targets to run retention on a cadence
 * (PRD §"No full infra Day 1" — no in-app cron). The branchy logic + audit live in the service (the
 * coverage gate collects `*.service.ts`); this controller just pins identity and routes.
 */
@Controller("admin/retention")
@Roles("admin")
export class RetentionController {
  constructor(private readonly service: RetentionService) {}

  /** Dry run: how many rows the next sweep would delete, per category. */
  @Get("preview")
  preview(@CurrentUser() user: AuthUser): Promise<RetentionPreviewDto> {
    return this.service.preview(user);
  }

  /** Run the retention sweep (destructive; audited). */
  @Post("sweep")
  sweep(@CurrentUser() user: AuthUser): Promise<RetentionSweepResultDto> {
    return this.service.sweep(user);
  }
}
