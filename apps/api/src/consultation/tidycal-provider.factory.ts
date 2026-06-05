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
 *     A decrypt failure (rotated/again-misconfigured key, corrupt ciphertext) returns `null` so the
 *     caller SKIPS that expert. It deliberately does NOT fall through to the env-global default: that
 *     would poll the shared calendar while still attributing the bookings to the failing expert,
 *     misassigning bookings/revenue (Security/Product review Cycle 4 High). An expert with a
 *     configured token gets that expert's calendar or nothing — never someone else's.
 *  2. **Env-global token** — `TIDYCAL_API_TOKEN` → {@link HttpTidyCalProvider}. The pre-migration
 *     default (the single shared calendar) and a safety net only for an expert with NO configured
 *     token, or the no-expert legacy poll.
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

  /**
   * Build the provider for one expert (or the env/offline default when `expert` is null).
   *
   * Returns `null` ONLY when the expert has a configured token that fails to decrypt — the caller must
   * then skip that expert rather than poll someone else's calendar under their id (see precedence #1).
   * An expert with no configured token resolves to the env/offline default.
   */
  forExpert(expert: ExpertCredentials | null): TidyCalProvider | null {
    if (expert?.tidycalApiTokenEnc) {
      try {
        const apiToken = decryptSecret(expert.tidycalApiTokenEnc);
        return new HttpTidyCalProvider({ apiToken });
      } catch (err) {
        // Never leak the ciphertext/plaintext — log only the expert id + the failure class. Return
        // null (skip) instead of falling back, so a decrypt failure can't misattribute the global
        // calendar's bookings to this expert.
        this.logger.warn("could not decrypt expert TidyCal token; skipping this expert's poll", {
          expertId: expert.id,
          error: err instanceof Error ? err.name : "unknown",
        });
        return null;
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
