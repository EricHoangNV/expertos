/**
 * The transactional-email seam (M9.3, PRD §"Concierge Mode" → async delivery). **All outbound email
 * goes through this interface — no app code imports a mail SDK directly**, so swapping SendGrid /
 * Postmark / SES / SMTP later is a new driver, not a rewrite (mirrors the {@link PaymentProvider} /
 * `TidyCalProvider` abstractions). The offline default ({@link OfflineEmailProvider}) keeps the whole
 * delivery path runnable without a mail provider or network (the `EchoLlmProvider` /
 * `InMemoryStorageProvider` pattern); a real HTTP driver swaps in behind the `EMAIL_PROVIDER` token
 * when its env config is present.
 *
 * Phase-1 scope is transactional email only (concierge "your answer was reviewed" notifications);
 * marketing/bulk and push are out of scope (push is Phase 2, per the PRD).
 */
export interface EmailProvider {
  /** Stable driver name, recorded in the send log (e.g. `http`, `offline`). */
  readonly name: string;

  /**
   * Send one transactional email. Throws {@link EmailDeliveryError} on a provider/transport failure
   * so the caller can decide whether to surface or swallow it (concierge delivery treats it as
   * non-fatal — a notification hiccup must never roll back the in-conversation delivery).
   */
  send(message: EmailMessage): Promise<void>;
}

/** A single transactional email. Plain text is required; `html` is an optional richer rendering. */
export interface EmailMessage {
  /** Recipient address. */
  to: string;
  subject: string;
  /** Plain-text body (always sent — the lowest-common-denominator rendering). */
  text: string;
  /** Optional HTML body. */
  html?: string;
}

/**
 * Thrown by a driver's {@link EmailProvider.send} when the transport/provider rejects the delivery.
 * Distinct error type so a caller can tell a delivery failure apart from a programming error.
 */
export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}
