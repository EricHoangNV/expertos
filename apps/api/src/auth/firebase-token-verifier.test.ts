import { UnauthorizedException } from "@nestjs/common";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import type { Auth } from "firebase-admin/auth";
import { createFirebaseApp } from "./firebase-admin.provider";
import { FirebaseTokenVerifier } from "./firebase-token-verifier";

// Mock the Admin app module so createFirebaseApp's init decisions are observable
// without touching the real (process-global) Firebase app registry.
jest.mock("firebase-admin/app", () => ({
  getApps: jest.fn(() => []),
  initializeApp: jest.fn((opts: unknown) => ({ __app: opts })),
  cert: jest.fn((c: unknown) => ({ __cert: c })),
}));

const mockGetApps = getApps as jest.MockedFunction<typeof getApps>;
const mockInitializeApp = initializeApp as jest.MockedFunction<typeof initializeApp>;
const mockCert = cert as jest.MockedFunction<typeof cert>;

describe("FirebaseTokenVerifier", () => {
  it("maps a verified token to the DecodedIdToken subset", async () => {
    const auth = {
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: "fb-uid",
        email: "u@example.com",
        name: "User",
        extra: "ignored",
      }),
    } as unknown as Auth;

    const result = await new FirebaseTokenVerifier(auth).verify("token");

    expect(result).toEqual({ uid: "fb-uid", email: "u@example.com", name: "User" });
  });

  it("throws UnauthorizedException when verification fails", async () => {
    const auth = {
      verifyIdToken: jest.fn().mockRejectedValue(new Error("expired")),
    } as unknown as Auth;

    await expect(new FirebaseTokenVerifier(auth).verify("bad")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe("createFirebaseApp", () => {
  beforeEach(() => {
    mockGetApps.mockReset().mockReturnValue([]);
    mockInitializeApp.mockClear();
    mockCert.mockClear();
  });

  it("throws when service-account credentials are missing", () => {
    expect(() => createFirebaseApp({} as NodeJS.ProcessEnv)).toThrow(
      /Firebase credentials missing/,
    );
    expect(mockInitializeApp).not.toHaveBeenCalled();
  });

  it("reuses an already-initialized app", () => {
    const existing = { __app: "existing" } as unknown as ReturnType<typeof initializeApp>;
    mockGetApps.mockReturnValue([existing]);

    expect(createFirebaseApp({} as NodeJS.ProcessEnv)).toBe(existing);
    expect(mockInitializeApp).not.toHaveBeenCalled();
  });

  it("initializes from a service-account cert in production mode", () => {
    createFirebaseApp({
      FIREBASE_PROJECT_ID: "proj",
      FIREBASE_CLIENT_EMAIL: "svc@proj.iam.gserviceaccount.com",
      FIREBASE_PRIVATE_KEY: "line1\\nline2",
    } as NodeJS.ProcessEnv);

    // Escaped newlines in the env value are unescaped before reaching cert().
    expect(mockCert).toHaveBeenCalledWith({
      projectId: "proj",
      clientEmail: "svc@proj.iam.gserviceaccount.com",
      privateKey: "line1\nline2",
    });
    expect(mockInitializeApp).toHaveBeenCalledWith({ credential: { __cert: expect.anything() } });
  });

  it("initializes without a cert when the Auth emulator host is set", () => {
    createFirebaseApp({
      FIREBASE_AUTH_EMULATOR_HOST: "localhost:9099",
      FIREBASE_PROJECT_ID: "expertos-e2e",
    } as NodeJS.ProcessEnv);

    expect(mockInitializeApp).toHaveBeenCalledWith({ projectId: "expertos-e2e" });
    expect(mockCert).not.toHaveBeenCalled();
  });

  it("falls back to a placeholder project id in emulator mode when none is configured", () => {
    createFirebaseApp({ FIREBASE_AUTH_EMULATOR_HOST: "localhost:9099" } as NodeJS.ProcessEnv);

    expect(mockInitializeApp).toHaveBeenCalledWith({ projectId: "demo-expertos" });
    expect(mockCert).not.toHaveBeenCalled();
  });
});
