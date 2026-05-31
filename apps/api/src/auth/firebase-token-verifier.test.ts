import { UnauthorizedException } from "@nestjs/common";
import type { Auth } from "firebase-admin/auth";
import { createFirebaseApp } from "./firebase-admin.provider";
import { FirebaseTokenVerifier } from "./firebase-token-verifier";

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
  it("throws when service-account credentials are missing", () => {
    expect(() => createFirebaseApp({} as NodeJS.ProcessEnv)).toThrow(
      /Firebase credentials missing/,
    );
  });
});
