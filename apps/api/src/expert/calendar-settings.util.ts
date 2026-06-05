import type { Prisma } from "@expertos/db";
import type {
  ExpertCalendarSettingsDto,
  ExpertCalendarSettingsUpdateInput,
} from "@expertos/shared";
import { encryptSecret, last4 } from "../common/secret-crypto";

/** The `experts` columns needed to render {@link ExpertCalendarSettingsDto} (never the ciphertext). */
export const CALENDAR_SELECT = {
  tidycalApiTokenEnc: true,
  tidycalApiTokenLast4: true,
  tidycalLink: true,
} satisfies Prisma.ExpertSelect;

/** Row shape {@link CALENDAR_SELECT} returns. */
export interface CalendarRow {
  tidycalApiTokenEnc: string | null;
  tidycalApiTokenLast4: string | null;
  tidycalLink: string | null;
}

/**
 * Map an expert row to the public calendar-settings DTO. The encrypted token is **never** returned —
 * only `apiTokenConfigured` (is one stored?) and the non-sensitive `last4` hint.
 */
export function toCalendarSettingsDto(row: CalendarRow): ExpertCalendarSettingsDto {
  return {
    apiTokenConfigured: row.tidycalApiTokenEnc !== null,
    apiTokenLast4: row.tidycalApiTokenLast4,
    tidycalLink: row.tidycalLink,
  };
}

/**
 * Build the Prisma update from a calendar-settings patch, encrypting the token at rest. Each field is
 * independent: `apiToken` non-empty → encrypt + store (with a fresh last4); `null` → clear both;
 * omitted → untouched. `tidycalLink` → set, or clear on `null`/`""`. Returns the changed field names so
 * the caller can audit *which* fields moved without ever logging the values.
 */
export function buildCalendarUpdate(
  input: ExpertCalendarSettingsUpdateInput,
): { data: Prisma.ExpertUpdateInput; changedFields: string[] } {
  const data: Prisma.ExpertUpdateInput = {};
  const changedFields: string[] = [];

  if (input.apiToken !== undefined) {
    if (input.apiToken === null) {
      data.tidycalApiTokenEnc = null;
      data.tidycalApiTokenLast4 = null;
    } else {
      data.tidycalApiTokenEnc = encryptSecret(input.apiToken);
      data.tidycalApiTokenLast4 = last4(input.apiToken);
    }
    changedFields.push("apiToken");
  }

  if (input.tidycalLink !== undefined) {
    data.tidycalLink = input.tidycalLink ? input.tidycalLink : null;
    changedFields.push("tidycalLink");
  }

  return { data, changedFields };
}
