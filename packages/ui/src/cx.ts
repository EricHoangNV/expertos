/**
 * Tiny className combiner — joins truthy class fragments with a space.
 * Keeps the design-system primitives free of a runtime dependency.
 */
export type ClassValue = string | false | null | undefined;

export function cx(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(" ");
}
