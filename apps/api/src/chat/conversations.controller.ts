import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from "@nestjs/common";
import {
  conversationListQuerySchema,
  conversationRenameSchema,
  type ConversationDetailDto,
  type ConversationListQueryInput,
  type ConversationRenameInput,
  type ConversationSummaryDto,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ConversationService } from "./conversation.service";

/**
 * Conversation history API (M3.2, PRD §"History & retention"). `@Roles('user')` is the broadest
 * authenticated audience; per-conversation ownership is enforced by Postgres RLS inside
 * {@link ConversationService} (a peer's conversation is invisible, so list/get/rename can only ever
 * touch the acting user's own chats). All branchy logic lives in the service so it stays under the
 * coverage gate.
 */
@Controller("conversations")
@Roles("user")
export class ConversationsController {
  constructor(private readonly conversations: ConversationService) {}

  /** The acting user's conversation history, most-recent-activity first. */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(conversationListQuerySchema))
    query: ConversationListQueryInput,
  ): Promise<ConversationSummaryDto[]> {
    return this.conversations.list(user, query);
  }

  /** One conversation with its full transcript. */
  @Get(":id")
  get(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ConversationDetailDto> {
    return this.conversations.get(user, id);
  }

  /** Rename a conversation, overriding its auto-derived title. */
  @Patch(":id")
  rename(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(conversationRenameSchema))
    body: ConversationRenameInput,
  ): Promise<ConversationSummaryDto> {
    return this.conversations.rename(user, id, body.title);
  }
}
