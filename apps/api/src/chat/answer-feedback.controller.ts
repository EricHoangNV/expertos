import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import {
  answerFeedbackSubmitSchema,
  type AnswerFeedbackDto,
  type AnswerFeedbackSubmitInput,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AnswerFeedbackService } from "./answer-feedback.service";

/**
 * Answer-feedback (👍/👎 + reason) API (M3.4, PRD §"Chat experience"). `@Roles('user')` is the
 * broadest authenticated audience; ownership is enforced by Postgres RLS inside
 * {@link AnswerFeedbackService} (`answer_feedback` is user-scoped, and submitting re-checks
 * conversation ownership server-side). All branchy logic lives in the service. Feedback is keyed
 * by `messageId`, so retraction targets the message — there is no separate feedback-row id surface.
 */
@Controller("answer-feedback")
@Roles("user")
export class AnswerFeedbackController {
  constructor(private readonly feedback: AnswerFeedbackService) {}

  /** Submit or revise feedback on an assistant answer. */
  @Post()
  submit(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(answerFeedbackSubmitSchema))
    body: AnswerFeedbackSubmitInput,
  ): Promise<AnswerFeedbackDto> {
    return this.feedback.submit(user, body);
  }

  /** Retract feedback on an assistant answer (by the rated message's id). */
  @Delete(":messageId")
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param("messageId", ParseUUIDPipe) messageId: string,
  ): Promise<void> {
    return this.feedback.remove(user, messageId);
  }
}
