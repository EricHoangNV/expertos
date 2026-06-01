import { type EmailMessage, type EmailProvider, EmailDeliveryError } from "./email-provider";

/**
 * The HTTP transport for a transactional-email REST API, declared structurally so this driver takes
 * **no mail-provider SDK dependency** (the Stripe `StripeHttpClient` / TidyCal `TidyCalHttpClient`
 * pattern). The default {@link FetchEmailHttpClient} uses the global `fetch`; a test injects a fake to
 * assert the request body/headers without a network call.
 */
export interface EmailHttpClient {
  /** POST a JSON `body` to the email API `url` with the given headers; resolves on a 2xx. */
  post(url: string, headers: Record<string, string>, body: unknown): Promise<void>;
}

interface HttpEmailProviderOptions {
  /** Full endpoint URL of the transactional-email API (provider-specific). */
  apiUrl: string;
  /** API key/token sent as a Bearer credential. */
  apiKey: string;
  /** The verified sender address the provider sends from. */
  from: string;
  /** Swappable transport (defaults to a `fetch`-based client). */
  httpClient?: EmailHttpClient;
}

/**
 * A generic transactional-email driver (Phase-1's only real {@link EmailProvider}). It POSTs a
 * provider-neutral JSON envelope (`{from, to, subject, text, html}`) with a Bearer key — the common
 * shape of most transactional-email APIs (SendGrid/Postmark/Resend/Mailgun all accept a near-identical
 * body). The network-free part (envelope construction) is exhaustively unit-tested via the injected
 * {@link EmailHttpClient}; the default `fetch` transport needs live network (verified at deploy, not
 * in CI — the M11 caveat, same as the Stripe / TidyCal HTTP transports). **Verify the exact envelope
 * field names against the chosen provider's docs when wiring the live account** (adjust the body shape
 * in {@link send} only).
 */
export class HttpEmailProvider implements EmailProvider {
  readonly name = "http";
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly from: string;
  private readonly http: EmailHttpClient;

  constructor(opts: HttpEmailProviderOptions) {
    this.apiUrl = opts.apiUrl;
    this.apiKey = opts.apiKey;
    this.from = opts.from;
    this.http = opts.httpClient ?? new FetchEmailHttpClient();
  }

  async send(message: EmailMessage): Promise<void> {
    const body: Record<string, unknown> = {
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    };
    if (message.html !== undefined) {
      body.html = message.html;
    }
    await this.http.post(
      this.apiUrl,
      {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body,
    );
  }
}

/** Default `fetch`-based transport. Throws {@link EmailDeliveryError} on a non-2xx response. */
class FetchEmailHttpClient implements EmailHttpClient {
  async post(url: string, headers: Record<string, string>, body: unknown): Promise<void> {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new EmailDeliveryError(`email API POST failed with ${res.status}`);
    }
  }
}
