import { z } from "zod";

/**
 * Access-control whitelist wire types (M14 + private beta, PRD-access-control). Access is
 * invite-only: the whitelist gates both surfaces. An `expert`/`admin` entry authorizes the admin
 * portal (and implicitly the consumer app); its role is synced onto the user on each admin-portal
 * sign-in. A `user` entry is a consumer-beta invite only — it passes the beta gate
 * (`AuthService.resolveUser`) but never authorizes the portal.
 */

/** Roles a whitelist entry may grant: the portal roles, or `user` (consumer-beta invite only). */
export const allowedEmailRoleSchema = z.enum(["user", "expert", "admin"]);
export type AllowedEmailRole = z.infer<typeof allowedEmailRoleSchema>;

/**
 * The two roles that authorize the admin portal. `POST /me/admin-session` can only ever return one
 * of these — a `user`-roled whitelist entry is denied there — so the portal contract stays tight
 * even though {@link allowedEmailRoleSchema} accepts `user` for beta invites.
 */
export const portalRoleSchema = z.enum(["expert", "admin"]);
export type PortalRole = z.infer<typeof portalRoleSchema>;

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
 * email is whitelisted with a portal role; a non-whitelisted or `user`-roled email gets a 403
 * instead. `role` is the synced role (the whitelist is the source of truth for portal roles).
 */
export interface AdminSessionDto {
  ok: true;
  role: PortalRole;
  user: {
    id: string;
    email: string;
    displayName: string | null;
  };
}
