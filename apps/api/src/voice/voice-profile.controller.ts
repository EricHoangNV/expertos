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
  voiceProfileCreateSchema,
  voiceProfileListQuerySchema,
  voiceProfileUpdateSchema,
  type VoiceProfileCreateInput,
  type VoiceProfileListQueryInput,
  type VoiceProfileUpdateInput,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { VoiceProfileService } from "./voice-profile.service";
import type { VoiceProfileDetail, VoiceProfileSummary } from "./voice.types";

/**
 * Expert/admin voice-profile authoring + sign-off API (M2.3) — the first admin/expert-portal
 * surface. Every route requires at least the `expert` role (admin satisfies it via the role
 * hierarchy); the per-profile ownership rule ("an expert signs off on their own voice") is
 * enforced inside {@link VoiceProfileService}, so an expert in the tenant can't act on a peer's
 * profile while an admin can operate across the tenant.
 */
@Controller("voice-profiles")
@Roles("expert")
export class VoiceProfileController {
  constructor(private readonly service: VoiceProfileService) {}

  /** The sign-off queue / authoring list (own profiles for an expert, all for an admin). */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(voiceProfileListQuerySchema))
    query: VoiceProfileListQueryInput,
  ): Promise<VoiceProfileSummary[]> {
    return this.service.list(user, query);
  }

  /** A single profile plus its style examples — the sign-off detail view (M13.5). */
  @Get(":id")
  get(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<VoiceProfileDetail> {
    return this.service.get(user, id);
  }

  /** Author a new draft voice profile. */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(voiceProfileCreateSchema))
    body: VoiceProfileCreateInput,
  ): Promise<VoiceProfileSummary> {
    return this.service.create(user, body);
  }

  /** Edit a draft profile's free-text fields. */
  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(voiceProfileUpdateSchema))
    body: VoiceProfileUpdateInput,
  ): Promise<VoiceProfileSummary> {
    return this.service.update(user, id, body);
  }

  /** Submit a draft for review (`draft` → `expert_review`). */
  @Post(":id/submit")
  @HttpCode(200)
  submit(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<VoiceProfileSummary> {
    return this.service.submit(user, id);
  }

  /** Sign off, publishing the profile (`expert_review` → `published`). */
  @Post(":id/approve")
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<VoiceProfileSummary> {
    return this.service.approve(user, id);
  }

  /** Send a reviewed profile back for changes (`expert_review` → `draft`). */
  @Post(":id/request-changes")
  @HttpCode(200)
  requestChanges(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<VoiceProfileSummary> {
    return this.service.requestChanges(user, id);
  }
}
