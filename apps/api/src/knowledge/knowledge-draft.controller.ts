import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  knowledgeDraftCreateSchema,
  knowledgeDraftListQuerySchema,
  knowledgeDraftUpdateSchema,
  type KnowledgeDraftCreateInput,
  type KnowledgeDraftDto,
  type KnowledgeDraftListQueryInput,
  type KnowledgeDraftSummaryDto,
  type KnowledgeDraftUpdateInput,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { KnowledgeDraftService } from "./knowledge-draft.service";

/**
 * Conversation-to-knowledge pipeline API (M8.2) — capture a valuable answer as a draft and
 * drive it through review to publication. Every route requires at least the `expert` role
 * (admin satisfies it via the role hierarchy); tenant isolation is enforced by Postgres RLS
 * inside {@link KnowledgeDraftService}.
 */
@Controller("knowledge-drafts")
@Roles("expert")
export class KnowledgeDraftController {
  constructor(private readonly service: KnowledgeDraftService) {}

  /** "Mark valuable": create a new draft. */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(knowledgeDraftCreateSchema))
    body: KnowledgeDraftCreateInput,
  ): Promise<KnowledgeDraftDto> {
    return this.service.create(user, body);
  }

  /** The draft review queue (filter by status). */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(knowledgeDraftListQuerySchema))
    query: KnowledgeDraftListQueryInput,
  ): Promise<KnowledgeDraftSummaryDto[]> {
    return this.service.list(user, query);
  }

  /** One draft with its full content. */
  @Get(":id")
  get(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<KnowledgeDraftDto> {
    return this.service.get(user, id);
  }

  /** Edit a draft's title/content (only while `draft`). */
  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(knowledgeDraftUpdateSchema))
    body: KnowledgeDraftUpdateInput,
  ): Promise<KnowledgeDraftDto> {
    return this.service.update(user, id, body);
  }

  /** Submit a draft for expert review (`draft` → `expert_review`). */
  @Post(":id/submit")
  @HttpCode(200)
  submit(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<KnowledgeDraftDto> {
    return this.service.submit(user, id);
  }

  /** Send a reviewed draft back for changes (`expert_review` → `draft`). */
  @Post(":id/request-changes")
  @HttpCode(200)
  requestChanges(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<KnowledgeDraftDto> {
    return this.service.requestChanges(user, id);
  }

  /** Discard a draft (`draft | expert_review` → `rejected`). */
  @Post(":id/reject")
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<KnowledgeDraftDto> {
    return this.service.reject(user, id);
  }

  /** Sign off, ingesting + publishing the draft (`expert_review` → `published`). */
  @Post(":id/publish")
  @HttpCode(200)
  publish(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<KnowledgeDraftDto> {
    return this.service.publish(user, id);
  }
}
