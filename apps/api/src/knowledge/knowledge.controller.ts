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
  knowledgeListQuerySchema,
  versionContentEditSchema,
  type KnowledgeDocumentDetailDto,
  type KnowledgeDocumentDto,
  type KnowledgeListQueryInput,
  type KnowledgeVersionDto,
  type VersionContentDto,
  type VersionContentEditInput,
  type VersionContentEditResultDto,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { IngestionService } from "../ingestion/ingestion.service";
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
  constructor(
    private readonly service: KnowledgeService,
    private readonly ingestion: IngestionService,
  ) {}

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

  /** A version's editable text (reconstructed from its chunks) for the edit-draft UI (Option B). */
  @Get("versions/:versionId/content")
  getVersionContent(
    @CurrentUser() user: AuthUser,
    @Param("versionId", ParseUUIDPipe) versionId: string,
  ): Promise<VersionContentDto> {
    return this.service.getVersionContent(user, versionId);
  }

  /** Edit a draft version's text (Option B) — re-chunks + re-embeds; draft-only (enforced in the repo). */
  @Patch("versions/:versionId/content")
  editVersionContent(
    @CurrentUser() user: AuthUser,
    @Param("versionId", ParseUUIDPipe) versionId: string,
    @Body(new ZodValidationPipe(versionContentEditSchema)) body: VersionContentEditInput,
  ): Promise<VersionContentEditResultDto> {
    return this.ingestion.editDraftContent(user, versionId, body.content);
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
