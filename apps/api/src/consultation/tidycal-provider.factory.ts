import { Injectable } from "@nestjs/common";
import { StructuredLogger } from "../observability/logger.service";
import { decryptSecret } from "../common/secret-crypto";
import type { TidyCalProvider } from "./tidycal-provider";
import { HttpTidyCalProvider } from "./http-tidycal-provider";
import { OfflineTidyCalProvider } from "./offline-tidycal-provider";

/** The expert fields the factory needs to build that expert's provider (its stored, encrypted token). */
export interface ExpertCredentials {
  id: string;
  tidycalApiTokenEnc: string | null;
}

/**
 * Resolves the {@link TidyCalProvider} for a given expert (M16). Replaces the single process-wide
 * `createDefaultTidyCalProvider` singleton: each expert owns their own TidyCal account, so the booking
 * poll must run with *that expert's* API token.
 *
 * **Resolution precedence** (highest first):
 *  1. **Per-expert token** — decrypt the expert's `tidycalApiTokenEnc` → {@link HttpTidyCalProvider}.
 *     A decrypt failure (rotated/again-misconfigured key, corrupt ciphertext) is logged and falls
 *     through rather than crashing the whole poll.
 *  2. **Env-global token** — `TIDYCAL_API_TOKEN` → {@link HttpTidyCalProvider}. The pre-migration
 *     default (the single shared calendar) and a safety net for an expert who hasn't configured one.
 *  3. **Offline** — {@link OfflineTidyCalProvider}: deterministic, no network. Local/dev/test default,
 *     and the only provider whose JSON-envelope webhook seam is live.
 *
 * Kept Prisma-free (the caller loads the expert row inside its own RLS transaction and passes it in),
 * so precedence is pure and exhaustively unit-testable. Secrets are decrypted **only here**, at the
 * point of building a network client, and never returned or logged.
 */
@Injectable()
export class TidyCalProviderFactory {
  constructor(private readonly logger: StructuredLogger) {}

  /** Build the provider for one expert (or the env/offline default when `expert` is null). */
  forExpert(expert: ExpertCredentials | null): TidyCalProvider {
    if (expert?.tidycalApiTokenEnc) {
      try {
        const apiToken = decryptSecret(expert.tidycalApiTokenEnc);
        return new HttpTidyCalProvider({ apiToken });
      } catch (err) {
        // Never leak the ciphertext/plaintext — log only the expert id + the failure class.
        this.logger.warn("could not decrypt expert TidyCal token; falling back", {
          expertId: expert.id,
          error: err instanceof Error ? err.name : "unknown",
        });
      }
    }
    return this.default();
  }

  /**
   * The non-expert-scoped default: the env-global TidyCal token if set, else the offline provider.
   * Used for the offline webhook test seam and as the fallback inside {@link forExpert}.
   */
  default(): TidyCalProvider {
    const apiToken = process.env.TIDYCAL_API_TOKEN;
    if (apiToken) {
      return new HttpTidyCalProvider({ apiToken });
    }
    return new OfflineTidyCalProvider();
  }
}
