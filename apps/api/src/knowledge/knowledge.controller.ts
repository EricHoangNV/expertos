import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  knowledgeListQuerySchema,
  type KnowledgeDocumentDetailDto,
  type KnowledgeDocumentDto,
  type KnowledgeListQueryInput,
  type KnowledgeVersionDto,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { KnowledgeService } from "./knowledge.service";

/**
 * Admin/expert knowledge publishing API (M8.1) — the versioned-publish + expert-review gate.
 * Every route requires at least the `expert` role (admin satisfies it via the role hierarchy);
 * tenant isolation is enforced by Postgres RLS inside {@link KnowledgeService}. The upload that
 * *creates* a draft version runs through the existing M1.1 ingestion pipeline (`publish:false`);
 * this controller drives the review/publish lifecycle of those versions.
 */
@Controller("knowledge")
@Roles("expert")
export class KnowledgeController {
  constructor(private readonly service: KnowledgeService) {}

  /** The knowledge list / review queue (filter by document status + scope). */
  @Get("documents")
  listDocuments(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(knowledgeListQuerySchema))
    query: KnowledgeListQueryInput,
  ): Promise<KnowledgeDocumentDto[]> {
    return this.service.listDocuments(user, query);
  }

  /** One document with its full version history. */
  @Get("documents/:id")
  getDocument(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<KnowledgeDocumentDetailDto> {
    return this.service.getDocument(user, id);
  }

  /** Submit a draft version for expert review (`draft` → `expert_review`). */
  @Post("versions/:versionId/submit")
  @HttpCode(200)
  submit(
    @CurrentUser() user: AuthUser,
    @Param("versionId", ParseUUIDPipe) versionId: string,
  ): Promise<KnowledgeVersionDto> {
    return this.service.submit(user, versionId);
  }

  /** Sign off, publishing the version (`expert_review` → `published`). */
  @Post("versions/:versionId/approve")
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthUser,
    @Param("versionId", ParseUUIDPipe) versionId: string,
  ): Promise<KnowledgeVersionDto> {
    return this.service.approve(user, versionId);
  }

  /** Send a reviewed version back for changes (`expert_review` → `draft`). */
  @Post("versions/:versionId/request-changes")
  @HttpCode(200)
  requestChanges(
    @CurrentUser() user: AuthUser,
    @Param("versionId", ParseUUIDPipe) versionId: string,
  ): Promise<KnowledgeVersionDto> {
    return this.service.requestChanges(user, versionId);
  }

  /** Retire a published version (`published` → `archived`). */
  @Post("versions/:versionId/archive")
  @HttpCode(200)
  archive(
    @CurrentUser() user: AuthUser,
    @Param("versionId", ParseUUIDPipe) versionId: string,
  ): Promise<KnowledgeVersionDto> {
    return this.service.archive(user, versionId);
  }
}
