import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption-at-rest for tenant/expert secrets (M16 — per-expert TidyCal API tokens).
 *
 * The repo had no encryption helper before this; every secret was env-only. Per-expert credentials
 * are configured at runtime and stored in Postgres, so they MUST be encrypted at rest: a DB dump or a
 * `SELECT` must never expose a usable TidyCal token. AES-256-GCM gives confidentiality **and**
 * tamper-evidence (the auth tag) — a flipped byte fails the tag check on decrypt instead of yielding
 * garbage plaintext.
 *
 * **Key management.** The 32-byte key comes from the `CREDENTIALS_ENCRYPTION_KEY` env var, base64-
 * encoded (out of band via Secret Manager, never committed). This is a single deliberate seam: a
 * later move to Cloud KMS envelope encryption swaps {@link loadKey} only, leaving every call site
 * unchanged. A missing/short key is a hard startup-time failure, never a silent fallback to plaintext.
 *
 * **Wire format.** `encryptSecret` returns `ivB64:authTagB64:ciphertextB64` (one self-describing
 * string per column, no separate IV/tag columns); `decryptSecret` parses it back. The IV is a fresh
 * 12 random bytes per call (GCM's nonce requirement — the same plaintext encrypts differently each
 * time, so equal tokens aren't detectable by equal ciphertext).
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // 96-bit nonce, the GCM-recommended size
const ENV_KEY = "CREDENTIALS_ENCRYPTION_KEY";

/**
 * Resolve the 32-byte master key from `CREDENTIALS_ENCRYPTION_KEY` (base64). Throws if unset or the
 * wrong length so a misconfigured deploy fails loudly rather than persisting unprotected secrets.
 * Exported for unit tests / startup validation; production code uses {@link encryptSecret} /
 * {@link decryptSecret}.
 */
export function loadKey(): Buffer {
  const raw = process.env[ENV_KEY];
  if (!raw) {
    throw new Error(
      `${ENV_KEY} is not set — cannot encrypt/decrypt secrets at rest. Provide a base64-encoded 32-byte key.`,
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error(`${ENV_KEY} is not valid base64.`);
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `${ENV_KEY} must decode to ${KEY_BYTES} bytes (got ${key.length}). Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

/** Whether a credentials key is configured — lets a provider factory fall back without throwing. */
export function isCredentialsKeyConfigured(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

/** Encrypt `plaintext` with `key` → `ivB64:authTagB64:ciphertextB64`. */
export function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Decrypt an `ivB64:authTagB64:ciphertextB64` payload with `key`. Throws on tamper or malformed input. */
export function decryptWithKey(payload: string, key: Buffer): string {
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted secret (expected ivB64:authTagB64:ciphertextB64).");
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  if (iv.length !== IV_BYTES) {
    throw new Error("Malformed encrypted secret (bad IV length).");
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag); // a wrong/flipped tag makes `final()` throw — tamper-evident
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Encrypt a secret with the env-configured master key. */
export function encryptSecret(plaintext: string): string {
  return encryptWithKey(plaintext, loadKey());
}

/** Decrypt a secret produced by {@link encryptSecret}. */
export function decryptSecret(payload: string): string {
  return decryptWithKey(payload, loadKey());
}

/**
 * The last 4 characters of a secret, for a non-reversible "configured ✓ ••••1234" hint in the UI.
 * Returns a fixed mask for very short secrets so we never echo most of a short token.
 */
export function last4(secret: string): string {
  return secret.length <= 4 ? "••••" : secret.slice(-4);
}
