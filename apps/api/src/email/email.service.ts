import { Inject, Injectable } from "@nestjs/common";
import type { EmailMessage, EmailProvider } from "./email-provider";
import { StructuredLogger } from "../observability/logger.service";
import { EMAIL_PROVIDER } from "./email.tokens";

/**
 * The single transactional-email choke point (M9.3). Domain code sends through this service rather
 * than touching {@link EmailProvider} directly, so logging is centralized in one place and the
 * provider stays swappable. Errors propagate to the caller — each caller decides whether a send
 * failure is fatal (concierge async delivery treats it as non-fatal: the in-conversation delivery is
 * the primary channel, the email is a best-effort notification).
 *
 * The recipient address is never logged in full (PII, directive §1) — only the driver name + subject.
 */
@Injectable()
export class EmailService {
  constructor(
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
    private readonly logger: StructuredLogger,
  ) {}

  /** Sends one transactional email through the configured driver. */
  async send(message: EmailMessage): Promise<void> {
    await this.provider.send(message);
    this.logger.info("transactional email sent", {
      provider: this.provider.name,
      subject: message.subject,
    });
  }
}
