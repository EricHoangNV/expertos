import type { Role } from "@expertos/shared";

/**
 * Base URL of the API. Defaults to the local dev port; production passes `NEXT_PUBLIC_API_URL`
 * as a build arg (the value is public — it only identifies the endpoint). Mirrors `chat-client.ts`.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** The API's machine-readable code for "signed in, but not invited to the private beta". */
export const BETA_ACCESS_DENIED = "BETA_ACCESS_DENIED";

/**
 * A non-2xx API response. Extends {@link Error} (so `err instanceof Error` / `err.message` handling
 * keeps working) and carries the HTTP `status` plus the body's machine-readable `code` — the beta
 * gate reads both to distinguish a 403 {@link BETA_ACCESS_DENIED} (not invited → deny screen) from
 * any other failure. Mirrors the admin portal's `admin-client.ts` ApiError.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The authenticated principal `GET /me` returns (the API's `AuthUser`, minus internal fields). */
export interface MeDto {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  locale: string;
}

/**
 * Resolve the signed-in user's principal (`GET /me`). With the private beta gate on, this is also
 * the consumer app's access check: a non-whitelisted email gets a 403 with
 * `code: BETA_ACCESS_DENIED` (thrown here as an {@link ApiError}), which the `AuthProvider` turns
 * into the deny screen.
 */
export async function fetchMe(token: string): Promise<MeDto> {
  const res = await fetch(`${API_URL}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const { message, code } = await errorDetails(res);
    throw new ApiError(res.status, message, code);
  }
  return (await res.json()) as MeDto;
}

/** Best-effort `{ message, code }` from an API error body, else the status text. */
async function errorDetails(res: Response): Promise<{ message: string; code: string | null }> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      const message = typeof record.message === "string" ? record.message : null;
      const code = typeof record.code === "string" ? record.code : null;
      if (message != null || code != null) {
        return { message: message ?? `Request failed (${res.status})`, code };
      }
    }
  } catch {
    // Non-JSON body — fall through to the generic message.
  }
  return { message: `Request failed (${res.status})`, code: null };
}
