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
import { getMe } from "./admin-client";

interface AuthContextValue {
  /** The signed-in Firebase user, or null when signed out. */
  user: User | null;
  /**
   * The signed-in user's resolved API role (from `GET /me`), or null while it's still resolving /
   * when signed out. Used to gate the portal nav (an expert sees a narrower set than an admin) — a
   * UX concern only; the API enforces the real role + RLS boundary on every route.
   */
  role: Role | null;
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

  // Resolve the API role once signed in, so the frame can show the right nav for an expert vs admin.
  useEffect(() => {
    if (!user) {
      setRole(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const token = await getFirebaseAuth().currentUser?.getIdToken();
        if (!token) {
          return;
        }
        const me = await getMe(token);
        if (!cancelled) {
          setRole(me.role);
        }
      } catch {
        // A failed lookup leaves role null — the nav falls back to the safe (expert) subset.
        if (!cancelled) {
          setRole(null);
        }
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
    [user, role, loading],
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
