/**
 * lib/crypto.ts
 * -------------
 * Symmetric encryption for the two secrets this app stores on behalf of a
 * user: a Telegram bot token, and an MTProto session string.
 *
 * The session string matters most — it is not a scoped token, it is full
 * standing access to somebody's personal Telegram account. A database dump
 * (or a leaked Supabase connection string) must not be enough to take those
 * over, so both are encrypted at rest with AES-256-GCM under a key that
 * lives only in the environment.
 *
 * Stored format: `v1:<iv b64>:<auth tag b64>:<ciphertext b64>`. Base64 never
 * contains a colon, so splitting on ":" is unambiguous, and the version
 * prefix doubles as the marker decryptSecret() uses to reject anything that
 * was stored unencrypted.
 */

import crypto from "crypto";

const PREFIX = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, the size GCM is defined for
const KEY_BYTES = 32;

/**
 * Read lazily rather than at module load: `next build` imports this file
 * while collecting page data, and a missing key should fail the request
 * that actually needs a secret, not the whole build.
 */
function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set — required to read or write Telegram bot tokens " +
        "and phone-account session strings. Generate one with `openssl rand -hex 32`.",
    );
  }

  const key = Buffer.from(raw, "hex");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must be ${KEY_BYTES} bytes as ${KEY_BYTES * 2} hex characters ` +
        `(got ${key.length}). Generate one with \`openssl rand -hex 32\`.`,
    );
  }
  return key;
}

function isEncrypted(value: string): boolean {
  return value.startsWith(`${PREFIX}:`);
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return [
    PREFIX,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSecret(stored: string): string {
  // Deliberately strict rather than passing unrecognised values through as
  // plaintext. A read site that forgets decryptSecret fails loudly on its own
  // (Telegram rejects a "v1:..." token), but a *write* site that forgets
  // encryptSecret would store plaintext that a lenient reader hands back
  // cleanly — a secret sitting unencrypted with nothing to notice. Throwing
  // here is what makes that impossible.
  if (!isEncrypted(stored)) {
    throw new Error(
      "Stored secret is not encrypted — some write path is missing an encryptSecret() " +
        "call and saved this value in plaintext. Reconnect the affected bot or phone " +
        "account after fixing it.",
    );
  }

  const [, ivB64, tagB64, ciphertextB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !ciphertextB64) {
    throw new Error("Stored secret is malformed — expected v1:<iv>:<tag>:<ciphertext>");
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // GCM's final() throws on tag mismatch, which in practice means the
    // ENCRYPTION_KEY changed. Say so explicitly — the raw OpenSSL error
    // ("Unsupported state or unable to authenticate data") sends people
    // looking in entirely the wrong place.
    throw new Error(
      "Failed to decrypt a stored secret — ENCRYPTION_KEY does not match the key it " +
        "was encrypted with. Restore the original key, or delete and reconnect the " +
        "affected bot / phone account.",
    );
  }
}
