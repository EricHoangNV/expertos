import { z } from "zod";

/**
 * Access-control whitelist wire types (M14, PRD-access-control). The admin portal is invite-only:
 * only a pre-authorized email may sign in, and the whitelist entry's role is synced onto the user on
 * each admin-portal sign-in. The consumer app (`role=user`) is unaffected.
 *
 * The whitelist grants only the two portal roles — `expert` or `admin` — never the base `user` role
 * (a whitelisted email is, by definition, a portal operator). That bound is enforced here at the app
 * layer, not by the DB enum (the column is the full {@link Role} enum).
 */

/** Roles a whitelist entry may grant (the portal roles only — never `user`). */
export const allowedEmailRoleSchema = z.enum(["expert", "admin"]);
export type AllowedEmailRole = z.infer<typeof allowedEmailRoleSchema>;

/** Add an email to the whitelist: a normalized email + the role to grant. */
export const allowedEmailCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  role: allowedEmailRoleSchema,
});
export type AllowedEmailCreateInput = z.infer<typeof allowedEmailCreateSchema>;

/** Change a whitelist entry's role (the only mutable field — email is the natural key). */
export const allowedEmailUpdateSchema = z.object({
  role: allowedEmailRoleSchema,
});
export type AllowedEmailUpdateInput = z.infer<typeof allowedEmailUpdateSchema>;

/** One whitelist entry, with the adder resolved to an email for display. */
export interface AllowedEmailDto {
  id: string;
  email: string;
  role: AllowedEmailRole;
  createdAt: string;
  /** Email of the admin who added the entry, or null if that account was since deleted (SetNull). */
  createdByEmail: string | null;
}

/**
 * The admin-portal sign-in result (`POST /me/admin-session`). Returned only when the signed-in
 * email is whitelisted; a non-whitelisted email gets a 403 instead. `role` is the synced role (the
 * whitelist is the source of truth for portal roles).
 */
export interface AdminSessionDto {
  ok: true;
  role: AllowedEmailRole;
  user: {
    id: string;
    email: string;
    displayName: string | null;
  };
}
