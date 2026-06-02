/**
 * i18n core (M13.1) — the pure, framework-agnostic half of the bilingual UI layer.
 *
 * Like {@link layout}/{@link prefs}, this module is a set of pure functions over plain
 * data so it stays directly unit-testable (no React, no DOM renderer). The React
 * wiring (a context provider + hooks + localStorage/profile persistence) lives in the
 * consuming app, which composes these helpers with a per-app message catalog. The
 * catalog itself (the EN/VI strings) is app-owned — admin and consumer surfaces have
 * different copy — so this file ships only the catalog *shape* and the lookup engine.
 */

/** UI locale — the two languages M1 supports (EN + VI). Structurally identical to `ChatLanguage`. */
export type Locale = "en" | "vi";

/** The supported locales, in display order. */
export const LOCALES: readonly Locale[] = ["en", "vi"];

/** The fallback locale used for SSR and before a stored/profile preference loads. */
export const DEFAULT_LOCALE: Locale = "en";

/** Narrow an unknown (e.g. a localStorage / profile value) to a {@link Locale}. */
export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "vi";
}

/**
 * A nested message catalog: dot-addressable strings (leaves) grouped under namespaces
 * (branches). e.g. `{ chat: { emptyTitle: "Start a new conversation" } }` →
 * `translate(cat, "chat.emptyTitle")`.
 */
export interface Messages {
  [key: string]: string | Messages;
}

/** Named values interpolated into a `{placeholder}` in a message string. */
export type TranslateParams = Record<string, string | number>;

/** A bound translator: `t(key, params)` over a fixed catalog (and optional namespace). */
export type Translator = (key: string, params?: TranslateParams) => string;

/**
 * Resolve a dot-path `key` against a message catalog, interpolating any `{name}`
 * placeholders from `params`. A missing key (or a path that lands on a branch, not a
 * leaf string) falls back to the key itself so an untranslated string surfaces as a
 * visible, greppable token rather than a blank — and the lookup never throws.
 */
export function translate(
  messages: Messages,
  key: string,
  params?: TranslateParams,
): string {
  const leaf = lookup(messages, key);
  if (typeof leaf !== "string") return key;
  return params ? interpolate(leaf, params) : leaf;
}

/**
 * Build a translator bound to a catalog and an optional namespace prefix, so callers
 * write `t("emptyTitle")` instead of `translate(cat, "chat.emptyTitle")`.
 */
export function createTranslator(
  messages: Messages,
  namespace?: string,
): Translator {
  const prefix = namespace ? `${namespace}.` : "";
  return (key, params) => translate(messages, `${prefix}${key}`, params);
}

/** Walk a dot-path to its node (a leaf string, a branch, or undefined if absent). */
function lookup(messages: Messages, key: string): string | Messages | undefined {
  let node: string | Messages | undefined = messages;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = node[part];
  }
  return node;
}

/** Replace `{name}` tokens with `params.name`; an unknown token is left verbatim. */
function interpolate(template: string, params: TranslateParams): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}
