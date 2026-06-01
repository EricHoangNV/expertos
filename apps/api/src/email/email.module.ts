import { Module } from "@nestjs/common";
import { EmailService } from "./email.service";
import { EMAIL_PROVIDER } from "./email.tokens";
import { createDefaultEmailProvider } from "./email.defaults";

/**
 * Wires the transactional-email seam (M9.3, PRD §"Concierge Mode" → async delivery). Provides the
 * swappable {@link EMAIL_PROVIDER} (real HTTP driver when its env config is present, else the offline
 * default — see `email.defaults.ts`) and exports the {@link EmailService} choke point for any module
 * that needs to send mail (today: concierge async delivery).
 */
@Module({
  providers: [
    EmailService,
    { provide: EMAIL_PROVIDER, useFactory: createDefaultEmailProvider },
  ],
  exports: [EmailService],
})
export class EmailModule {}
