import { Body, Controller, Post, Res } from "@nestjs/common";
import { chatRequestSchema, type ChatRequestInput } from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import { RequiresEntitlement } from "../entitlements/requires-entitlement.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ChatService } from "./chat.service";

/**
 * Minimal Server-Sent-Events surface the response handler needs. Declared structurally (the same
 * pattern as the observability filter/middleware) so the controller can be unit-tested with a
 * fake response and the route never depends on the Express type surface.
 */
interface SseResponse {
  setHeader(name: string, value: string): void;
  write(chunk: string): void;
  end(): void;
}

/**
 * The chat endpoint (M3.1). `@Roles('user')` is the broadest authenticated audience (experts and
 * admins satisfy it via the role hierarchy). It streams the answer as SSE over the Express
 * response: prose arrives as `delta` frames and a single terminal `done` frame carries the
 * persisted ids + resolved citations (rendered only after generation completes — Open Decision
 * #7). `@Res()` opts this route out of Nest's automatic serialization, which is required to
 * stream; all branchy logic lives in {@link ChatService} so it stays under the coverage gate.
 *
 * `@RequiresEntitlement('ask_question')` meters the route (M6.1): the {@link EntitlementGuard}
 * consumes one unit of the actor's per-window question quota before streaming, or returns `402`
 * with an upgrade payload at the wall.
 */
@Controller("chat")
@Roles("user")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  @RequiresEntitlement("ask_question")
  async stream(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(chatRequestSchema)) body: ChatRequestInput,
    @Res() res: SseResponse,
  ): Promise<void> {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    // Disable proxy buffering so frames reach the client immediately (Cloud Run / nginx).
    res.setHeader("X-Accel-Buffering", "no");

    for await (const event of this.chat.answerStream(user, body)) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    res.end();
  }
}
