// Manual jest mock for `firebase/auth` (auto-applied to every admin test, M15.2.1).
//
// Delegates "who is signed in" to the shared, test-controllable `test/auth-state`
// so the real `AuthProvider` + `src/lib/firebase.ts` run unchanged on top of fakes
// (no real Firebase SDK, no network). Set the user with `setMockUser(...)` before
// rendering and `onAuthStateChanged` fires with it synchronously on mount.

import {
  getMockUser,
  registerAuthListener,
  setMockUser,
  type MockUser,
} from "../../test/auth-state";

export type Auth = {
  readonly currentUser: MockUser | null;
};

const auth: Auth = {
  get currentUser() {
    return getMockUser();
  },
};

export function getAuth(): Auth {
  return auth;
}

export class GoogleAuthProvider {}

export function connectAuthEmulator(): void {
  /* no-op under jest */
}

export function onAuthStateChanged(
  _auth: Auth,
  next: (user: MockUser | null) => void,
): () => void {
  return registerAuthListener(next);
}

export async function signInWithPopup(): Promise<{ user: MockUser | null }> {
  // Default behaviour: a popup sign-in with no preset user is a no-op success.
  // Tests that assert on sign-in set the user explicitly via `setMockUser`.
  return { user: getMockUser() };
}

export async function signOut(): Promise<void> {
  setMockUser(null);
}

export async function signInWithEmailAndPassword(
  _auth: Auth,
  _email: string,
  _password: string,
): Promise<{ user: MockUser | null }> {
  return { user: getMockUser() };
}

export type User = MockUser;
