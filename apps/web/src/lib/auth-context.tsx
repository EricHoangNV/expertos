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

interface AuthContextValue {
  /** The signed-in Firebase user, or null when signed out. */
  user: User | null;
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

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
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
    [user, loading],
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
