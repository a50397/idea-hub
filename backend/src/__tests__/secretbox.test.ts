// Unit coverage for utils/secretbox.ts — AES-256-GCM authenticated encryption of
// the single stored SMTP password. The key is read lazily from MAIL_SETTINGS_KEY,
// so each test sets it then calls (mirroring the config-getter env convention).
//
// Invariants proven here:
//   1. Roundtrip: decrypt(encrypt(x)) === x.
//   2. Fresh random IV per call (same plaintext -> different ciphertext).
//   3. Fail-CLOSED decryption: tampering, the wrong key, malformed input, or a
//      missing/invalid key all return null and NEVER throw.
//   4. The key accepts BOTH 64-char hex (documented default) and 32-byte base64.

import { encrypt, decrypt } from '../utils/secretbox';

// Two distinct valid 32-byte keys, in hex (the documented form).
const KEY_A = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const KEY_B = 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100';

let savedKey: string | undefined;

beforeAll(() => {
  savedKey = process.env.MAIL_SETTINGS_KEY;
});

afterAll(() => {
  if (savedKey === undefined) delete process.env.MAIL_SETTINGS_KEY;
  else process.env.MAIL_SETTINGS_KEY = savedKey;
});

beforeEach(() => {
  process.env.MAIL_SETTINGS_KEY = KEY_A;
});

describe('encrypt / decrypt roundtrip', () => {
  it('recovers the original plaintext', () => {
    const secret = 'sup3r-s3cret-relay-pass!';
    const payload = encrypt(secret);
    expect(decrypt(payload)).toBe(secret);
  });

  it('recovers an empty string and unicode', () => {
    expect(decrypt(encrypt(''))).toBe('');
    expect(decrypt(encrypt('héllo — Ľubomír 🔐'))).toBe('héllo — Ľubomír 🔐');
  });

  it('produces the base64(iv).base64(tag).base64(ct) shape with a 12-byte iv and 16-byte tag', () => {
    const payload = encrypt('abc');
    const parts = payload.split('.');
    expect(parts).toHaveLength(3);
    expect(Buffer.from(parts[0], 'base64')).toHaveLength(12); // iv
    expect(Buffer.from(parts[1], 'base64')).toHaveLength(16); // auth tag
    expect(Buffer.from(parts[2], 'base64').length).toBeGreaterThan(0); // ciphertext
    // The ciphertext must not be the plaintext.
    expect(payload).not.toContain('abc');
  });

  it('uses a fresh IV per call (same plaintext -> different ciphertext, both decrypt)', () => {
    const a = encrypt('same-secret');
    const b = encrypt('same-secret');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('same-secret');
    expect(decrypt(b)).toBe('same-secret');
  });
});

describe('decrypt fails closed (returns null, never throws)', () => {
  it('returns null when a ciphertext byte is flipped (GCM auth failure)', () => {
    const payload = encrypt('tamper-me');
    const parts = payload.split('.');
    const ct = Buffer.from(parts[2], 'base64');
    ct[0] ^= 0xff; // flip the first ciphertext byte
    const tampered = [parts[0], parts[1], ct.toString('base64')].join('.');
    expect(decrypt(tampered)).toBeNull();
  });

  it('returns null when the auth tag is tampered', () => {
    const payload = encrypt('tamper-tag');
    const parts = payload.split('.');
    const tag = Buffer.from(parts[1], 'base64');
    tag[0] ^= 0xff;
    const tampered = [parts[0], tag.toString('base64'), parts[2]].join('.');
    expect(decrypt(tampered)).toBeNull();
  });

  it('returns null when decrypted with the wrong key', () => {
    const payload = encrypt('key-rotated');
    process.env.MAIL_SETTINGS_KEY = KEY_B;
    expect(decrypt(payload)).toBeNull();
  });

  it('returns null for malformed payloads', () => {
    for (const bad of ['', 'not-a-payload', 'a.b', 'a.b.c.d', '....', 'x.y.z']) {
      expect(decrypt(bad)).toBeNull();
    }
  });

  it('returns null when the key is missing', () => {
    delete process.env.MAIL_SETTINGS_KEY;
    // Build a payload with a key present, then remove the key before decrypting.
    process.env.MAIL_SETTINGS_KEY = KEY_A;
    const payload = encrypt('no-key-on-read');
    delete process.env.MAIL_SETTINGS_KEY;
    expect(decrypt(payload)).toBeNull();
  });
});

describe('encrypt key handling', () => {
  it('throws when the key is missing or not a valid 32-byte value', () => {
    delete process.env.MAIL_SETTINGS_KEY;
    expect(() => encrypt('x')).toThrow(/MAIL_SETTINGS_KEY/);

    process.env.MAIL_SETTINGS_KEY = 'too-short';
    expect(() => encrypt('x')).toThrow(/MAIL_SETTINGS_KEY/);
  });

  it('accepts a 64-char hex key (the documented default form)', () => {
    process.env.MAIL_SETTINGS_KEY = KEY_A;
    expect(decrypt(encrypt('hex-keyed'))).toBe('hex-keyed');
  });

  it('accepts a base64 key that decodes to exactly 32 bytes', () => {
    process.env.MAIL_SETTINGS_KEY = Buffer.from(KEY_A, 'hex').toString('base64');
    expect(decrypt(encrypt('base64-keyed'))).toBe('base64-keyed');
  });

  it('rejects a base64 key of the wrong length', () => {
    process.env.MAIL_SETTINGS_KEY = Buffer.from('short').toString('base64');
    expect(() => encrypt('x')).toThrow(/MAIL_SETTINGS_KEY/);
  });
});
