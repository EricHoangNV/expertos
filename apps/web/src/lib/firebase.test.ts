/**
 * Tests for `src/lib/firebase.ts` (M15.1.6) — the emulator-aware Firebase client init.
 *
 * The module reads env at eval time (`isFirebaseConfigured`) and wires the Auth emulator only
 * when `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` is set, so each case re-evaluates the module
 * with a fresh env via `jest.resetModules()`. `firebase/app` + `firebase/auth` are auto-mocked
 * (see `__mocks__/firebase/*`), so no real SDK or network is touched. (firebase.ts is excluded
 * from coverage collection as a thin SDK wrapper, but the emulator/e2e branches are worth pinning.)
 */

// Re-require the modules fresh after each `jest.resetModules()` so env changes take effect.
// (Typed via `import type` so there's no `any`; `require` is the only way to re-eval per case.)
function loadFirebase(): typeof import("./firebase") {
  return require("./firebase");
}
function loadAuthMock(): typeof import("firebase/auth") {
  return require("firebase/auth");
}

describe("firebase.ts", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete window.__e2eSignIn;
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it("reports configured when the public API key is present", () => {
    jest.resetModules();
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "test-api-key";
    expect(loadFirebase().isFirebaseConfigured).toBe(true);
  });

  it("reports not configured when the API key is missing", () => {
    jest.resetModules();
    delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    expect(loadFirebase().isFirebaseConfigured).toBe(false);
  });

  it("caches a single Auth instance across calls", () => {
    jest.resetModules();
    const fb = loadFirebase();
    expect(fb.getFirebaseAuth()).toBe(fb.getFirebaseAuth());
  });

  it("exposes a GoogleAuthProvider instance", () => {
    jest.resetModules();
    const { googleProvider } = loadFirebase();
    const { GoogleAuthProvider } = loadAuthMock();
    expect(googleProvider).toBeInstanceOf(GoogleAuthProvider);
  });

  it("connects Auth to the emulator when the host env is set", () => {
    jest.resetModules();
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
    const authMock = loadAuthMock();
    const spy = jest.spyOn(authMock, "connectAuthEmulator");
    loadFirebase().getFirebaseAuth();
    expect(spy).toHaveBeenCalledWith(expect.anything(), "http://localhost:9099", {
      disableWarnings: true,
    });
  });

  it("does not touch the emulator in production (host unset)", () => {
    jest.resetModules();
    delete process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
    const authMock = loadAuthMock();
    const spy = jest.spyOn(authMock, "connectAuthEmulator");
    loadFirebase().getFirebaseAuth();
    expect(spy).not.toHaveBeenCalled();
  });

  it("installs window.__e2eSignIn only under the emulator", () => {
    jest.resetModules();
    delete process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
    delete window.__e2eSignIn;
    loadFirebase();
    expect(window.__e2eSignIn).toBeUndefined();

    jest.resetModules();
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
    loadFirebase();
    expect(typeof window.__e2eSignIn).toBe("function");
  });

  it("__e2eSignIn signs in against the emulator via signInWithEmailAndPassword", async () => {
    jest.resetModules();
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
    const authMock = loadAuthMock();
    const spy = jest.spyOn(authMock, "signInWithEmailAndPassword");
    loadFirebase();
    await window.__e2eSignIn?.("e2e@example.com", "pw");
    expect(spy).toHaveBeenCalledWith(expect.anything(), "e2e@example.com", "pw");
  });
});
