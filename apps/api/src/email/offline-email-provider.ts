import type { EmailMessage, EmailProvider } from "./email-provider";

/**
 * The offline transactional-email default (M9.3). Sends nothing over the network — it just records
 * the most recent message so a local/dev/test run can assert what *would* have been emailed (the
 * `InMemoryStorageProvider` / `OfflinePaymentProvider` pattern). Swapped for a real driver behind the
 * `EMAIL_PROVIDER` token when mail-provider env config is present.
 */
export class OfflineEmailProvider implements EmailProvider {
  readonly name = "offline";

  /** The last message handed to {@link send} (for local inspection / assertions). */
  lastMessage: EmailMessage | null = null;

  send(message: EmailMessage): Promise<void> {
    this.lastMessage = message;
    return Promise.resolve();
  }
}
