import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminModule } from "../admin/admin.module";
import { AppSettingsController } from "./app-settings.controller";
import { SettingsService } from "./settings.service";
import { SETTINGS_EMBEDDING_PROVIDER_NAME, resolveEmbeddingProviderName } from "./settings.tokens";

/**
 * Wires the M17 runtime answer-tuning settings (PRD §"M17 — Runtime answer-tuning settings").
 *
 * M17.2 ships the admin Settings editor ({@link AppSettingsController} + {@link SettingsService}) over
 * the `app_settings` global singleton — LLM temperature, default chat model, and retrieval score floor,
 * tunable with no deploy. The service also exposes `getCached()` (a 30s TTL snapshot of the tunable
 * triple) for the hot answer path; the module is imported by {@link ChatModule} (M17.3 threads
 * temperature + model through the LLM call) and {@link RetrievalModule} (M17.4 applies the score floor),
 * and exports {@link SettingsService} for both.
 *
 * `AuthModule` supplies {@link RlsService} (admin reads/writes) + the auth guards/decorators;
 * `AdminModule` exports {@link AdminAuditService} (the audit sink the editor writes through). The
 * read-only embedding-provider name is resolved from the environment at composition time.
 */
@Module({
  imports: [AuthModule, AdminModule],
  controllers: [AppSettingsController],
  providers: [
    SettingsService,
    { provide: SETTINGS_EMBEDDING_PROVIDER_NAME, useFactory: resolveEmbeddingProviderName },
  ],
  exports: [SettingsService],
})
export class SettingsModule {}
