import type { Locale } from "@expertos/ui";
import type { UserProfileDto } from "@expertos/shared";

/**
 * Base URL of the API. Defaults to the local dev port; production passes `NEXT_PUBLIC_API_URL`
 * as a build arg (the value is public — it only identifies the endpoint). Mirrors the other clients.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** The slice of `GET /me` (the authenticated principal) the locale layer reads. */
interface MeResponse {
  locale: Locale;
}

/**
 * Reads the acting user's persisted locale (`GET /me`, M13.1). Used to seed the locale on a fresh
 * device where localStorage has no cached preference yet.
 */
export async function fetchProfileLocale(token: string): Promise<Locale> {
  const res = await fetch(`${API_URL}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`profile request failed (${res.status})`);
  }
  const me = (await res.json()) as MeResponse;
  return me.locale;
}

/**
 * Persists the chosen locale onto the user profile (`PATCH /me/locale`, M13.1) so the preference
 * follows the account across devices. Best-effort: the caller already updated localStorage + UI.
 */
export async function updateProfileLocale(
  token: string,
  locale: Locale,
): Promise<UserProfileDto> {
  const res = await fetch(`${API_URL}/me/locale`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ locale }),
  });
  if (!res.ok) {
    throw new Error(`locale update failed (${res.status})`);
  }
  return (await res.json()) as UserProfileDto;
}
