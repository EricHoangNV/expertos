"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createTranslator,
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
  type Translator,
} from "@expertos/ui";
import { useAuth } from "../auth-context";
import { MESSAGES } from "./dictionaries";
import { fetchProfileLocale, updateProfileLocale } from "./profile-client";

/** localStorage key for the same-device locale preference (M13.3). Distinct from the web app key. */
const LOCALE_STORAGE_KEY = "expertos:admin-locale";

interface LocaleContextValue {
  /** The active admin/expert portal UI locale. */
  locale: Locale;
  /** Switch the locale: updates the UI, caches to localStorage, and persists to the profile. */
  setLocale: (next: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

/**
 * Owns the admin/expert portal locale (M13.3). Mirrors the consumer web `LocaleProvider`: the locale
 * drives the UI language via {@link useT}.
 *
 * Resolution order: SSR renders the default; after mount a same-device localStorage preference wins;
 * otherwise the user's persisted profile locale seeds it on sign-in. Switching the locale writes
 * through to both localStorage (same-device) and the profile (`PATCH /me/locale`, cross-device).
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const { user, getIdToken } = useAuth();
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  // Whether a same-device preference exists — guards the profile seed from clobbering a local choice.
  const hasLocalPref = useRef(false);

  // Restore the same-device preference after mount (hydration-safe: SSR renders the default).
  useEffect(() => {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) {
      hasLocalPref.current = true;
      setLocaleState(stored);
    }
  }, []);

  // Seed from the user profile on sign-in when there is no same-device preference yet.
  useEffect(() => {
    if (!user || hasLocalPref.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getIdToken();
        if (!token) return;
        const serverLocale = await fetchProfileLocale(token);
        if (!cancelled && !hasLocalPref.current) {
          setLocaleState(serverLocale);
          window.localStorage.setItem(LOCALE_STORAGE_KEY, serverLocale);
        }
      } catch {
        // Best-effort: keep the default/local locale if the profile read fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getIdToken]);

  // Reflect the active locale onto <html lang> (a11y + correct hyphenation/spellcheck).
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(
    (next: Locale) => {
      hasLocalPref.current = true;
      setLocaleState(next);
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
      void (async () => {
        try {
          const token = await getIdToken();
          if (token) await updateProfileLocale(token, next);
        } catch {
          // Best-effort: localStorage already holds the preference for this device.
        }
      })();
    },
    [getIdToken],
  );

  const value = useMemo<LocaleContextValue>(() => ({ locale, setLocale }), [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale must be used within a <LocaleProvider>");
  }
  return ctx;
}

/** A translator bound to the active locale, optionally scoped to a `namespace` (M13.3). */
export function useT(namespace?: string): Translator {
  const { locale } = useLocale();
  return useMemo(() => createTranslator(MESSAGES[locale], namespace), [locale, namespace]);
}

/**
 * Returns a locale-aware replacement for the generic `statusLabel` helper (M13.3): it maps a
 * lifecycle-status enum token (`expert_review`, `booked`, `past_due`, …) to its localized label via
 * the shared `common.status.*` catalog. An unmapped token falls back to the humanized English form
 * (underscore → space) the original `statusLabel` produced, so a new/unknown status never breaks.
 */
export function useStatusLabel(): (status: string) => string {
  const t = useT("common");
  return useCallback(
    (status: string) => {
      const key = `status.${status}`;
      const label = t(key);
      return label === key ? status.replace(/_/g, " ") : label;
    },
    [t],
  );
}
