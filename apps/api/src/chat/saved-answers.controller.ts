import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  savedAnswerCreateSchema,
  savedAnswerListQuerySchema,
  type SavedAnswerCreateInput,
  type SavedAnswerDto,
  type SavedAnswerListQueryInput,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SavedAnswerService } from "./saved-answer.service";

/**
 * Saved-answers (bookmarks) API (M3.2, PRD §"History & retention"). `@Roles('user')` is the
 * broadest authenticated audience; ownership is enforced by Postgres RLS inside
 * {@link SavedAnswerService} (`saved_answers` is user-scoped, and bookmarking re-checks
 * conversation ownership server-side). All branchy logic lives in the service.
 */
@Controller("saved-answers")
@Roles("user")
export class SavedAnswersController {
  constructor(private readonly saved: SavedAnswerService) {}

  /** Bookmark an assistant answer. */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(savedAnswerCreateSchema))
    body: SavedAnswerCreateInput,
  ): Promise<SavedAnswerDto> {
    return this.saved.create(user, body);
  }

  /** The acting user's bookmarks, most recent first. */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(savedAnswerListQuerySchema))
    query: SavedAnswerListQueryInput,
  ): Promise<SavedAnswerDto[]> {
    return this.saved.list(user, query);
  }

  /** Remove a bookmark. */
  @Delete(":id")
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.saved.remove(user, id);
  }
}
