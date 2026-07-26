// Authenticated symmetric encryption for the single stored SMTP password.
//
// AES-256-GCM via node's built-in crypto (NO third-party dependency). The key is
// read lazily from MAIL_SETTINGS_KEY at call time so the deployment can be
// reconfigured and tests can set it per-case (mirrors the config-getter style
// used elsewhere in the backend). index.ts enforces the key's presence at boot
// (fatal outside development, ephemeral-with-warning in development), exactly like
// SESSION_SECRET.
//
// On-the-wire format (a single string, safe to store in Mongo):
//   base64(iv) "." base64(authTag) "." base64(ciphertext)
//
// Decryption is TOTAL and fail-closed: any problem — a missing/invalid key, a
// malformed payload, or a GCM authentication failure (tampered ciphertext/tag or
// the wrong key) — returns null instead of throwing. Callers treat null as
// "no usable password" and degrade to unauthenticated/log-only behavior; they
// must NEVER crash a request over it.

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // 96-bit nonce — the standard/recommended size for GCM
const TAG_BYTES = 16; // 128-bit GCM authentication tag
const SEPARATOR = '.';

/**
 * Resolve the 32-byte key from MAIL_SETTINGS_KEY.
 *
 * Accepts EITHER a 64-character hex string (preferred; matches SESSION_SECRET's
 * `crypto.randomBytes(32).toString('hex')`) OR a base64 string that decodes to
 * exactly 32 bytes. The hex form is checked first because a 64-char hex string is
 * also valid base64 (decoding to 48 bytes), and hex is the documented default.
 *
 * Returns null when the variable is unset/blank or is not a valid 32-byte value,
 * so both encrypt and decrypt can fail closed rather than use a wrong-sized key.
 */
function loadKey(): Buffer | null {
  const raw = (process.env.MAIL_SETTINGS_KEY ?? '').trim();
  if (!raw) return null;

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  try {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === KEY_BYTES) return decoded;
  } catch {
    /* fall through to null */
  }
  return null;
}

/**
 * Encrypt a UTF-8 plaintext, returning `base64(iv).base64(tag).base64(ct)`.
 *
 * A fresh random IV is generated per call, so encrypting the same plaintext twice
 * yields different ciphertext. Throws only when the key is missing/invalid — a
 * boot-guaranteed configuration error (index.ts guarantees MAIL_SETTINGS_KEY is
 * set), surfaced as a 500 by the calling route rather than silently storing a bad
 * secret.
 */
export function encrypt(plaintext: string): string {
  const key = loadKey();
  if (!key) {
    throw new Error(
      'MAIL_SETTINGS_KEY is not configured or is not a 32-byte hex/base64 value; cannot encrypt the mail password.'
    );
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(SEPARATOR);
}

/**
 * Decrypt a payload produced by encrypt(). Returns the plaintext, or null on ANY
 * failure: missing/invalid key, malformed input, wrong part count/lengths, or a
 * GCM authentication failure (tampering or wrong key). Never throws.
 */
export function decrypt(payload: string): string | null {
  const key = loadKey();
  if (!key) return null;
  if (typeof payload !== 'string' || payload.length === 0) return null;

  const parts = payload.split(SEPARATOR);
  if (parts.length !== 3) return null;

  try {
    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const ciphertext = Buffer.from(parts[2], 'base64');

    // Reject obviously malformed inputs before touching the cipher.
    if (iv.length !== IV_BYTES || authTag.length !== TAG_BYTES) return null;

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    // GCM auth failure (tampered ct/tag or wrong key) or any decode error.
    return null;
  }
}
