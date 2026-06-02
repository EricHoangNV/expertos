import { z } from "zod";
import { languageSchema, type LanguageValue } from "./ingestion";
import type { Role } from "./roles";

/**
 * User-profile self-service wire types (M13.1). Currently the only mutable profile field is the
 * UI/answer locale — the language toggle (M12.3.3) persists the chosen locale to the user row so it
 * follows the account across devices, on top of the same-device localStorage cache. Any authenticated
 * user may update their own profile; ownership is enforced by Postgres RLS (the `users` row is scoped
 * to the acting tenant), so no `@Roles` gate is needed.
 */

/** Update the acting user's preferred locale (`PATCH /me/locale`). */
export const localeUpdateSchema = z.object({
  locale: languageSchema,
});
export type LocaleUpdateInput = z.infer<typeof localeUpdateSchema>;

/** The acting user's profile, returned after a successful update. */
export interface UserProfileDto {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  locale: LanguageValue;
}
