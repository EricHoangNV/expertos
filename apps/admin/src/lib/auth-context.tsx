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
import type { Role } from "@expertos/shared";
import { getFirebaseAuth, googleProvider, isFirebaseConfigured } from "./firebase";
import { adminSession, ApiError } from "./admin-client";

interface AuthContextValue {
  /** The signed-in Firebase user, or null when signed out. */
  user: User | null;
  /**
   * The signed-in user's resolved API role (from `POST /me/admin-session`), or null while it's still
   * resolving / when signed out / when denied. Used to gate the portal nav (an expert sees a
   * narrower set than an admin) — a UX concern only; the API enforces the real role + RLS boundary
   * on every route.
   */
  role: Role | null;
  /**
   * True when the signed-in email is NOT on the admin-portal whitelist (the session call returned a
   * 403). The frame renders an Access Denied screen (M14). Resets to false while signed out /
   * resolving.
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
  const [role, setRole] = useState<Role | null>(null);
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

  // Resolve the admin session once signed in: the whitelist gate (M14) syncs + returns the role, or
  // 403s for a non-whitelisted email → `denied`. This is what activates the invite-only block.
  useEffect(() => {
    if (!user) {
      setRole(null);
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
        const session = await adminSession(token);
        if (!cancelled) {
          setRole(session.role);
          setDenied(false);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        // A 403 means the email is not whitelisted → hard deny. Any other failure (network, token)
        // leaves role null without flipping the deny screen, so a transient error isn't mistaken for
        // a deny.
        setRole(null);
        setDenied(err instanceof ApiError && err.status === 403);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      role,
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
    [user, role, denied, loading],
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
