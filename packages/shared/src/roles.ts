import { z } from "zod";

/**
 * RBAC roles for ExpertOS. Ordered by privilege (lowest → highest).
 * Used by the API auth guard and the admin/expert portals.
 */
export const ROLES = ["user", "expert", "admin"] as const;

export const roleSchema = z.enum(ROLES);

export type Role = z.infer<typeof roleSchema>;

const RANK: Record<Role, number> = {
  user: 0,
  expert: 1,
  admin: 2,
};

/**
 * Returns true when `actual` satisfies the `required` role, i.e. the actor's
 * privilege level is greater than or equal to the required level.
 */
export function satisfiesRole(actual: Role, required: Role): boolean {
  return RANK[actual] >= RANK[required];
}
