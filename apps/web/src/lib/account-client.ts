import type { EntitlementsDto } from "@expertos/shared";

/**
 * Base URL of the API. Defaults to the local dev port; production passes `NEXT_PUBLIC_API_URL`
 * as a build arg (the value is public — it only identifies the endpoint). Mirrors `chat-client.ts`.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Fetches the acting user's plan plus every feature's access / remaining metered quota
 * (`GET /me/entitlements`, M6.1/M6.3). Powers the transparent usage indicator so a quota wall is
 * never a surprise mid-task. The plan + quotas are resolved server-side from the user's active
 * subscription (else Free); RLS scopes the read to the caller.
 */
export async function fetchEntitlements(token: string): Promise<EntitlementsDto> {
  const res = await fetch(`${API_URL}/me/entitlements`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`entitlements request failed (${res.status})`);
  }
  return (await res.json()) as EntitlementsDto;
}
