"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { getFirebaseAuth, googleProvider, isFirebaseConfigured } from "./firebase";
import { ApiError, BETA_ACCESS_DENIED, fetchMe } from "./me-client";

interface AuthContextValue {
  /** The signed-in Firebase user, or null when signed out. */
  user: User | null;
  /**
   * True when the signed-in email is not invited to the private beta (`GET /me` returned a 403 with
   * `code: BETA_ACCESS_DENIED`). The `BetaGateBoundary` renders the deny screen. Resets to false
   * while signed out / resolving. Mirrors the admin portal's whitelist `denied` state.
   */
  denied: boolean;
  /** True until the initial auth state has resolved. */
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  /** Current ID token for `Authorization: Bearer …` calls to the API. */
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }
    return onAuthStateChanged(getFirebaseAuth(), (next) => {
      setUser(next);
      setLoading(false);
    });
  }, []);

  // Beta-gate check once signed in: `GET /me` 403s with BETA_ACCESS_DENIED for a non-whitelisted
  // email while the private beta gate is on → `denied`. Any other failure (network, token) leaves
  // `denied` false, so a transient error isn't mistaken for a deny.
  useEffect(() => {
    if (!user) {
      setDenied(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const token = await getFirebaseAuth().currentUser?.getIdToken();
        if (!token) {
          return;
        }
        await fetchMe(token);
        if (!cancelled) {
          setDenied(false);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        setDenied(
          err instanceof ApiError && err.status === 403 && err.code === BETA_ACCESS_DENIED,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      denied,
      loading,
      signInWithGoogle: async () => {
        await signInWithPopup(getFirebaseAuth(), googleProvider);
      },
      signOutUser: async () => {
        await signOut(getFirebaseAuth());
      },
      getIdToken: () => {
        const current = getFirebaseAuth().currentUser;
        return current ? current.getIdToken() : Promise.resolve(null);
      },
    }),
    [user, denied, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an <AuthProvider>");
  }
  return ctx;
}
