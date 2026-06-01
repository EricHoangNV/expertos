import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CacheModule } from "../cache/cache.module";
import { ConciergeModule } from "../concierge/concierge.module";
import { ConsultationModule } from "../consultation/consultation.module";
import { RetrievalModule } from "../retrieval/retrieval.module";
import { VoiceModule } from "../voice/voice.module";
import {
  createDefaultLlmProvider,
  createDegradedLlmProvider,
} from "../ingestion/ingestion.defaults";
import { ChatController } from "./chat.controller";
import { ConversationsController } from "./conversations.controller";
import { SavedAnswersController } from "./saved-answers.controller";
import { AnswerFeedbackController } from "./answer-feedback.controller";
import { ChatService } from "./chat.service";
import { ConversationService } from "./conversation.service";
import { SavedAnswerService } from "./saved-answer.service";
import { AnswerFeedbackService } from "./answer-feedback.service";
import { CHAT_DEGRADED_LLM_PROVIDER, CHAT_LLM_PROVIDER } from "./chat.tokens";

/**
 * Wires the M3.1 chat experience. It composes the M1 retrieval seam ({@link RetrievalModule})
 * and the M2 voice seam ({@link VoiceModule}) — their first consumer — with conversation
 * persistence and the chat LLM. The completion provider comes from the same composition-root
 * factory the ingestion pipeline uses, so production swaps the real driver in one place.
 *
 * `AuthModule` supplies {@link RlsService} (used by {@link ConversationService}); `UsageLogService`
 * / `StructuredLogger` come from the global `ObservabilityModule`.
 */
@Module({
  imports: [AuthModule, CacheModule, ConciergeModule, ConsultationModule, RetrievalModule, VoiceModule],
  controllers: [
    ChatController,
    ConversationsController,
    SavedAnswersController,
    AnswerFeedbackController,
  ],
  providers: [
    ChatService,
    ConversationService,
    SavedAnswerService,
    AnswerFeedbackService,
    { provide: CHAT_LLM_PROVIDER, useFactory: createDefaultLlmProvider },
    { provide: CHAT_DEGRADED_LLM_PROVIDER, useFactory: createDegradedLlmProvider },
  ],
  exports: [ChatService],
})
export class ChatModule {}
