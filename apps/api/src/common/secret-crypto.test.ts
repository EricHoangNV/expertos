import { randomBytes } from "node:crypto";
import {
  decryptSecret,
  decryptWithKey,
  encryptSecret,
  encryptWithKey,
  isCredentialsKeyConfigured,
  last4,
  loadKey,
} from "./secret-crypto";

const KEY = randomBytes(32);
const KEY_B64 = KEY.toString("base64");

describe("secret-crypto", () => {
  const original = process.env.CREDENTIALS_ENCRYPTION_KEY;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    } else {
      process.env.CREDENTIALS_ENCRYPTION_KEY = original;
    }
  });

  describe("encryptWithKey / decryptWithKey", () => {
    it("round-trips a secret", () => {
      const plain = "tidycal_token_abc123";
      const enc = encryptWithKey(plain, KEY);
      expect(decryptWithKey(enc, KEY)).toBe(plain);
    });

    it("never returns the plaintext in the ciphertext envelope", () => {
      const plain = "super-secret-value";
      const enc = encryptWithKey(plain, KEY);
      expect(enc).not.toContain(plain);
      expect(enc.split(":")).toHaveLength(3);
    });

    it("produces a different ciphertext each call (fresh IV)", () => {
      const plain = "same-input";
      expect(encryptWithKey(plain, KEY)).not.toBe(encryptWithKey(plain, KEY));
    });

    it("round-trips unicode + empty string", () => {
      for (const plain of ["", "Ngô Công Trường ✓", "🔒".repeat(50)]) {
        expect(decryptWithKey(encryptWithKey(plain, KEY), KEY)).toBe(plain);
      }
    });

    it("throws when the auth tag is tampered (GCM integrity)", () => {
      const enc = encryptWithKey("payload", KEY);
      const [iv, , ct] = enc.split(":");
      const forgedTag = randomBytes(16).toString("base64");
      expect(() => decryptWithKey([iv, forgedTag, ct].join(":"), KEY)).toThrow();
    });

    it("throws when the ciphertext is tampered", () => {
      const enc = encryptWithKey("payload", KEY);
      const [iv, tag, ct] = enc.split(":");
      const flipped = Buffer.from(ct, "base64");
      flipped[0] ^= 0xff;
      expect(() =>
        decryptWithKey([iv, tag, flipped.toString("base64")].join(":"), KEY),
      ).toThrow();
    });

    it("throws when decrypted with the wrong key", () => {
      const enc = encryptWithKey("payload", KEY);
      expect(() => decryptWithKey(enc, randomBytes(32))).toThrow();
    });

    it("rejects a malformed payload", () => {
      expect(() => decryptWithKey("not-a-valid-envelope", KEY)).toThrow(/Malformed/);
      expect(() => decryptWithKey("a:b", KEY)).toThrow(/Malformed/);
    });

    it("rejects a bad IV length", () => {
      const enc = encryptWithKey("payload", KEY);
      const [, tag, ct] = enc.split(":");
      const shortIv = randomBytes(8).toString("base64");
      expect(() => decryptWithKey([shortIv, tag, ct].join(":"), KEY)).toThrow(/IV length/);
    });
  });

  describe("loadKey", () => {
    it("loads a valid base64 32-byte key", () => {
      process.env.CREDENTIALS_ENCRYPTION_KEY = KEY_B64;
      expect(loadKey()).toEqual(KEY);
      expect(isCredentialsKeyConfigured()).toBe(true);
    });

    it("throws when unset", () => {
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;
      expect(() => loadKey()).toThrow(/not set/);
      expect(isCredentialsKeyConfigured()).toBe(false);
    });

    it("throws when the key is the wrong length", () => {
      process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(16).toString("base64");
      expect(() => loadKey()).toThrow(/32 bytes/);
      expect(isCredentialsKeyConfigured()).toBe(false);
    });
  });

  describe("encryptSecret / decryptSecret (env key)", () => {
    it("round-trips via the env-configured key", () => {
      process.env.CREDENTIALS_ENCRYPTION_KEY = KEY_B64;
      const plain = "env-keyed-secret";
      expect(decryptSecret(encryptSecret(plain))).toBe(plain);
    });

    it("throws on encrypt when no key is configured", () => {
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;
      expect(() => encryptSecret("x")).toThrow(/not set/);
    });
  });

  describe("last4", () => {
    it("returns the last 4 chars of a normal secret", () => {
      expect(last4("tidycal_token_5678")).toBe("5678");
    });
    it("masks short secrets entirely", () => {
      expect(last4("abc")).toBe("••••");
      expect(last4("abcd")).toBe("••••");
    });
  });
});
