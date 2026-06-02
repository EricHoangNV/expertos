// Shared, controllable Firebase-auth state for the admin jest harness (M15.2.1).
// Mirrors `apps/web/test/auth-state.ts`.
//
// The `__mocks__/firebase/*` manual mocks (auto-applied to every admin test) delegate
// to this module so a test can set "who is signed in" via `setMockUser(...)` and the
// real `AuthProvider` / `src/lib/firebase.ts` code paths run unchanged on top of it.

export interface MockUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  /** Mirrors `firebase.User.getIdToken()` — the bearer token the API clients send. */
  getIdToken: () => Promise<string>;
}

type Listener = (user: MockUser | null) => void;

let currentUser: MockUser | null = null;
let listeners: Listener[] = [];

/** Build a mock signed-in user; `getIdToken` resolves a stable fake token by default. */
export function makeMockUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    uid: "u_test",
    email: "member@example.com",
    displayName: "Test Member",
    getIdToken: async () => "test-id-token",
    ...overrides,
  };
}

/** Set (or clear) the signed-in user and notify every registered auth listener. */
export function setMockUser(user: MockUser | null): void {
  currentUser = user;
  for (const listener of listeners) listener(currentUser);
}

export function getMockUser(): MockUser | null {
  return currentUser;
}

/** Register an `onAuthStateChanged` callback: fires immediately with the current user. */
export function registerAuthListener(listener: Listener): () => void {
  listeners.push(listener);
  listener(currentUser);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/** Reset auth + listeners between tests (called from `jest.setup`). */
export function resetAuthState(): void {
  currentUser = null;
  listeners = [];
}
