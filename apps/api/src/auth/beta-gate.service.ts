import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@expertos/db";
import { PRISMA } from "../database/database.module";

/** How long {@link BetaGateService.isEnabled} serves a snapshot before re-reading the row. */
const CACHE_TTL_MS = 30_000;

/**
 * The private-beta gate flag, read on every authenticated request by {@link AuthService.resolveUser}.
 *
 * Lives in the auth module (not {@link SettingsService}) because `SettingsModule` imports
 * `AuthModule` — injecting the settings service into the auth path would be a circular dependency.
 * Clones the `SettingsService.getCached` pattern instead: a 30s in-process TTL snapshot of the
 * `app_settings` singleton's `betaGateEnabled` column, read through the global `PrismaClient`
 * (the row is RLS-exempt global config), so the gate costs no per-request DB hit.
 *
 * An unseeded DB defaults to enabled — mirroring the column default, and the safe (closed) posture
 * for a private beta. `SettingsService.updateSettings` calls {@link bust} on save so a flip is live
 * immediately on that instance; other instances converge within the TTL, same as the settings cache.
 */
@Injectable()
export class BetaGateService {
  /** The last snapshot + its expiry; null until the first read or after a bust. */
  private cached: { value: boolean; expiresAt: number } | null = null;

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** Whether the beta gate is on (whitelist required for consumer access). */
  async isEnabled(): Promise<boolean> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) {
      return this.cached.value;
    }

    const row = await this.prisma.appSettings.findFirst({
      select: { betaGateEnabled: true },
    });
    const value = row?.betaGateEnabled ?? true;

    this.cached = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  }

  /** Drop the snapshot so the next read hits the DB (called on settings save). */
  bust(): void {
    this.cached = null;
  }
}
