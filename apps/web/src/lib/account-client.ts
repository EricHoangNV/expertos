import type { AvailablePlansDto, EntitlementsDto } from "@expertos/shared";

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

/**
 * Fetches the purchasable upgrade plans for the acting user (`GET /me/plans`, M6.2) — the tiers above
 * their current plan plus whether they already hold a paid plan. Powers the self-serve checkout CTA.
 */
export async function fetchUpgradePlans(token: string): Promise<AvailablePlansDto> {
  const res = await fetch(`${API_URL}/me/plans`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`plans request failed (${res.status})`);
  }
  return (await res.json()) as AvailablePlansDto;
}

/**
 * Starts a hosted Stripe checkout for `planKey`/`interval` (`POST /billing/checkout`, M6.2) and returns
 * the provider-hosted URL the caller redirects to. The success/cancel targets are chosen server-side,
 * never sent from here, so the flow can't be turned into an open redirect.
 */
export async function startCheckout(
  token: string,
  planKey: string,
  interval: "month" | "year",
): Promise<string> {
  const res = await fetch(`${API_URL}/billing/checkout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ planKey, interval }),
  });
  if (!res.ok) {
    throw new Error(`checkout request failed (${res.status})`);
  }
  const { url } = (await res.json()) as { url: string };
  return url;
}

/**
 * Opens the provider customer portal (`POST /billing/portal`, M6.2) for managing or cancelling the
 * subscription, returning the hosted URL the caller redirects to.
 */
export async function openBillingPortal(token: string): Promise<string> {
  const res = await fetch(`${API_URL}/billing/portal`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`portal request failed (${res.status})`);
  }
  const { url } = (await res.json()) as { url: string };
  return url;
}
