// Unit coverage for the best-effort mail infrastructure after the DB-backed
// rework:
//   - config/mail.ts   (async getEffectiveMailConfig over the singleton settings)
//   - utils/mailer.ts  (sendMail: never throws; log-only when disabled; async)
//
// Prisma is mocked at the @prisma/client boundary (so lib/prisma resolves to the
// mock) to control the single MailSettings document. nodemailer is mocked. The
// REAL secretbox is used with a fixed test key so decryption is genuine.

const mockPrisma: { mailSettings: { findUnique: jest.Mock } } = {
  mailSettings: { findUnique: jest.fn() },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
}));

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

import os from 'node:os';
import nodemailer from 'nodemailer';
import { sendMail, sendTestMail } from '../utils/mailer';
// Namespace import so we can jest.spyOn the SAME getEffectiveMailConfig binding the
// mailer calls internally, to assert a caller-provided override SKIPS the read.
import * as mailConfig from '../config/mail';
import { getEffectiveMailConfig, type EffectiveMailConfig } from '../config/mail';
import { encrypt } from '../utils/secretbox';

const createTransport = nodemailer.createTransport as jest.Mock;
const findUnique = mockPrisma.mailSettings.findUnique;

const DEFAULT_FROM = 'IdeaHub <no-reply@ideahub.local>';
// 64 hex chars == 32 bytes (the documented hex key form).
const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

let savedKey: string | undefined;
let logSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;

/** Build a MailSettings-shaped document with disabled defaults + overrides. */
function doc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'settings1',
    enabled: false,
    host: '',
    port: 587,
    secure: false,
    username: '',
    passwordEnc: '',
    from: DEFAULT_FROM,
    language: 'en',
    subjectTemplate: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Wire createTransport to a fresh sendMail mock and return it. */
function mockTransport(sendImpl: jest.Mock): jest.Mock {
  createTransport.mockReturnValue({ sendMail: sendImpl });
  return sendImpl;
}

beforeAll(() => {
  savedKey = process.env.MAIL_SETTINGS_KEY;
  process.env.MAIL_SETTINGS_KEY = TEST_KEY;
});

afterAll(() => {
  if (savedKey === undefined) delete process.env.MAIL_SETTINGS_KEY;
  else process.env.MAIL_SETTINGS_KEY = savedKey;
});

beforeEach(() => {
  findUnique.mockReset();
  createTransport.mockReset();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// config/mail.ts — getEffectiveMailConfig()
// ---------------------------------------------------------------------------
describe('getEffectiveMailConfig', () => {
  it('returns disabled defaults when no settings document exists', async () => {
    findUnique.mockResolvedValue(null);
    const cfg = await getEffectiveMailConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.effectiveEnabled).toBe(false);
    expect(cfg.host).toBe('');
    expect(cfg.port).toBe(587);
    expect(cfg.secure).toBe(false);
    expect(cfg.user).toBe('');
    expect(cfg.pass).toBe('');
    expect(cfg.from).toBe(DEFAULT_FROM);
    expect(cfg.language).toBe('en');
    expect(cfg.subjectTemplate).toBe('');
    expect(cfg.hasPassword).toBe(false);
    expect(cfg.passwordDecryptable).toBe(false);
  });

  it('reads host/port/secure/username/from and is effectiveEnabled when enabled with a host', async () => {
    findUnique.mockResolvedValue(
      doc({
        enabled: true,
        host: 'smtp.corp.example',
        port: 465,
        secure: true,
        username: 'relay-user',
        from: 'Ideas <ideas@corp.example>',
      })
    );
    const cfg = await getEffectiveMailConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.effectiveEnabled).toBe(true);
    expect(cfg.host).toBe('smtp.corp.example');
    expect(cfg.port).toBe(465);
    expect(cfg.secure).toBe(true);
    expect(cfg.user).toBe('relay-user');
    expect(cfg.from).toBe('Ideas <ideas@corp.example>');
  });

  it('is enabled but NOT effectiveEnabled when the host is empty', async () => {
    findUnique.mockResolvedValue(doc({ enabled: true, host: '' }));
    const cfg = await getEffectiveMailConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.effectiveEnabled).toBe(false);
  });

  it('decrypts a stored password (roundtrip via the real secretbox)', async () => {
    findUnique.mockResolvedValue(
      doc({ enabled: true, host: 'h', username: 'u', passwordEnc: encrypt('relay-pass') })
    );
    const cfg = await getEffectiveMailConfig();
    expect(cfg.pass).toBe('relay-pass');
    expect(cfg.hasPassword).toBe(true);
    expect(cfg.passwordDecryptable).toBe(true);
  });

  it('tolerates an undecryptable stored password (null-safe, no throw)', async () => {
    findUnique.mockResolvedValue(
      doc({ enabled: true, host: 'h', username: 'u', passwordEnc: 'not-valid-ciphertext' })
    );
    const cfg = await getEffectiveMailConfig();
    expect(cfg.pass).toBe('');
    expect(cfg.hasPassword).toBe(true);
    expect(cfg.passwordDecryptable).toBe(false);
  });

  it('normalizes the language (sk kept; unknown falls back to en)', async () => {
    findUnique.mockResolvedValue(doc({ language: 'sk' }));
    expect((await getEffectiveMailConfig()).language).toBe('sk');
    findUnique.mockResolvedValue(doc({ language: 'de' }));
    expect((await getEffectiveMailConfig()).language).toBe('en');
  });

  it('treats a whitespace-only subjectTemplate as empty (built-in subject)', async () => {
    findUnique.mockResolvedValue(doc({ subjectTemplate: '   ' }));
    expect((await getEffectiveMailConfig()).subjectTemplate).toBe('');
  });
});

// ---------------------------------------------------------------------------
// utils/mailer.ts — sendMail() disabled / effective-disabled (log-only)
// ---------------------------------------------------------------------------
describe('sendMail (disabled / log-only)', () => {
  it('resolves true and never builds a transport when disabled (no document)', async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      sendMail({ to: 'alice@example.com', subject: 'Hello', text: 'Body' })
    ).resolves.toBe(true);
    expect(createTransport).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('[MAIL disabled] to=alice@example.com subject=Hello');
  });

  it('treats enabled-but-no-host as disabled (no transport)', async () => {
    findUnique.mockResolvedValue(doc({ enabled: true, host: '' }));
    await expect(
      sendMail({ to: 'alice@example.com', subject: 'Hello', text: 'Body' })
    ).resolves.toBe(true);
    expect(createTransport).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('[MAIL disabled] to=alice@example.com subject=Hello');
  });

  it('joins an array of recipients for the disabled log line', async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      sendMail({ to: ['a@x.com', 'b@y.com'], subject: 'Hi', text: 'Body' })
    ).resolves.toBe(true);
    expect(logSpy).toHaveBeenCalledWith('[MAIL disabled] to=a@x.com, b@y.com subject=Hi');
  });
});

// ---------------------------------------------------------------------------
// utils/mailer.ts — sendMail() enabled (real transport path)
// ---------------------------------------------------------------------------
describe('sendMail (enabled)', () => {
  it('creates a transport with host/port/secure and NO auth when the username is unset', async () => {
    findUnique.mockResolvedValue(doc({ enabled: true, host: 'smtp.corp.example', port: 2525 }));
    const send = mockTransport(jest.fn().mockResolvedValue({ messageId: 'x' }));

    await expect(
      sendMail({ to: 'alice@example.com', subject: 'Hello', text: 'Body' })
    ).resolves.toBe(true);

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.corp.example', port: 2525, secure: false })
    );
    expect(createTransport.mock.calls[0][0]).not.toHaveProperty('auth');
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: DEFAULT_FROM,
        to: 'alice@example.com',
        subject: 'Hello',
        text: 'Body',
      })
    );
  });

  it('includes an auth object (with the decrypted password) only when a username is set', async () => {
    findUnique.mockResolvedValue(
      doc({
        enabled: true,
        host: 'smtp.corp.example',
        username: 'relay-user',
        passwordEnc: encrypt('relay-pass'),
      })
    );
    mockTransport(jest.fn().mockResolvedValue({}));

    await sendMail({ to: 'alice@example.com', subject: 'Hello', text: 'Body' });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: 'relay-user', pass: 'relay-pass' } })
    );
  });

  it('passes secure=true through as implicit TLS', async () => {
    findUnique.mockResolvedValue(doc({ enabled: true, host: 'smtp.corp.example', secure: true }));
    mockTransport(jest.fn().mockResolvedValue({}));

    await sendMail({ to: 'alice@example.com', subject: 'Hello', text: 'Body' });

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true }));
  });

  it('forwards an array of recipients unchanged to sendMail', async () => {
    findUnique.mockResolvedValue(doc({ enabled: true, host: 'smtp.corp.example' }));
    const send = mockTransport(jest.fn().mockResolvedValue({}));

    await sendMail({ to: ['a@x.com', 'b@y.com'], subject: 'Hi', text: 'Body' });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ['a@x.com', 'b@y.com'] }));
  });

  it('includes html only when provided', async () => {
    findUnique.mockResolvedValue(doc({ enabled: true, host: 'smtp.corp.example' }));
    const send = mockTransport(jest.fn().mockResolvedValue({}));

    await sendMail({ to: 'alice@example.com', subject: 'Hello', text: 'Body', html: '<p>Body</p>' });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ html: '<p>Body</p>' }));
  });

  it('warns (without logging the secret) on an undecryptable stored password and sends without it', async () => {
    findUnique.mockResolvedValue(
      doc({
        enabled: true,
        host: 'smtp.corp.example',
        username: 'relay-user',
        passwordEnc: 'garbage-that-will-not-decrypt',
      })
    );
    mockTransport(jest.fn().mockResolvedValue({}));

    await expect(
      sendMail({ to: 'alice@example.com', subject: 'Hello', text: 'Body' })
    ).resolves.toBe(true);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnMsg = String(warnSpy.mock.calls[0][0]);
    expect(warnMsg).toContain('MAIL_SETTINGS_KEY');
    expect(warnMsg).not.toContain('garbage-that-will-not-decrypt');
    // Auth still attempted for the configured user, but with an empty password.
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: 'relay-user', pass: '' } })
    );
  });
});

// ---------------------------------------------------------------------------
// utils/mailer.ts — subject sanitization (header / log injection defense)
// ---------------------------------------------------------------------------
describe('sendMail (subject sanitization)', () => {
  // Control chars are built via fromCharCode so no raw CR/LF byte lives in the
  // source. CR=13, LF=10.
  const CR = String.fromCharCode(13);
  const LF = String.fromCharCode(10);

  it('folds CR/LF out of the subject before handing it to transport (header-injection defense); boolean unaffected', async () => {
    findUnique.mockResolvedValue(doc({ enabled: true, host: 'smtp.corp.example' }));
    const send = mockTransport(jest.fn().mockResolvedValue({}));

    // A newline in a user-controlled idea title trying to smuggle an extra header.
    const injected = `Legit subject${CR}${LF}Bcc: attacker@evil.com`;

    await expect(
      sendMail({ to: 'alice@example.com', subject: injected, text: 'Body' })
    ).resolves.toBe(true);

    const sentSubject = send.mock.calls[0][0].subject as string;
    // No CR/LF reaches nodemailer -> the injected "Bcc:" can never start a new
    // header line (defense-in-depth over nodemailer's own header encoding).
    expect(sentSubject).not.toContain(CR);
    expect(sentSubject).not.toContain(LF);
    // The two lines are folded onto one with a single space.
    expect(sentSubject).toBe('Legit subject Bcc: attacker@evil.com');
    // Body text is deliberately left UNTOUCHED.
    expect(send.mock.calls[0][0].text).toBe('Body');
  });

  it('folds CR/LF out of the subject in the [MAIL disabled] log line too (log-injection defense)', async () => {
    findUnique.mockResolvedValue(null); // disabled -> log-only path, no transport

    await expect(
      sendMail({
        to: 'alice@example.com',
        subject: `Hi${CR}${LF}[MAIL disabled] to=forged`,
        text: 'Body',
      })
    ).resolves.toBe(true);

    expect(createTransport).not.toHaveBeenCalled();
    const logged = String(logSpy.mock.calls[0][0]);
    // A single folded line: the newline cannot forge a second, fake log entry.
    expect(logged).toBe('[MAIL disabled] to=alice@example.com subject=Hi [MAIL disabled] to=forged');
    expect(logged).not.toContain(CR);
    expect(logged).not.toContain(LF);
  });
});

// ---------------------------------------------------------------------------
// utils/mailer.ts — failure paths (best-effort: never throws)
// ---------------------------------------------------------------------------
describe('sendMail (failure is swallowed)', () => {
  beforeEach(() => {
    findUnique.mockResolvedValue(doc({ enabled: true, host: 'smtp.corp.example' }));
  });

  it('resolves false and logs when transport.sendMail rejects', async () => {
    const send = mockTransport(jest.fn().mockRejectedValue(new Error('relay down')));

    await expect(
      sendMail({ to: 'alice@example.com', subject: 'Hello', text: 'Body' })
    ).resolves.toBe(false);

    expect(send).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[MAIL] send failed'),
      expect.anything()
    );
  });

  it('resolves false and logs when createTransport itself throws', async () => {
    createTransport.mockImplementation(() => {
      throw new Error('bad transport config');
    });

    await expect(
      sendMail({ to: 'alice@example.com', subject: 'Hello', text: 'Body' })
    ).resolves.toBe(false);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[MAIL] send failed'),
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// utils/mailer.ts — settings read failure (DB down): best-effort false
// ---------------------------------------------------------------------------
describe('sendMail (settings read failure)', () => {
  it('resolves false and logs, never building a transport, when the settings read rejects', async () => {
    findUnique.mockRejectedValue(new Error('mongo unreachable'));

    await expect(
      sendMail({ to: 'alice@example.com', subject: 'Hello', text: 'Body' })
    ).resolves.toBe(false);

    expect(createTransport).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[MAIL] settings read failed'),
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// utils/mailer.ts — sendMail(options, cfgOverride): FIX 4 — the caller (the idea
// notification path) already read the effective config to build the template, so it
// passes that SAME config through and sendMail must NOT read it again. When the
// override is provided, getEffectiveMailConfig is never called (proven via a spy)
// and no DB read happens (findUnique untouched); every other guarantee is identical
// to the self-read path. Without an override, the self-read behavior is unchanged.
// ---------------------------------------------------------------------------
describe('sendMail (caller-provided config override — FIX 4: single read)', () => {
  let cfgSpy: jest.SpyInstance;

  beforeEach(() => {
    // Spy on the exact binding sendMail calls internally. Left calling through so the
    // no-override test still reads the (mocked) DB via the real getEffectiveMailConfig.
    cfgSpy = jest.spyOn(mailConfig, 'getEffectiveMailConfig');
  });

  afterEach(() => {
    cfgSpy.mockRestore();
  });

  /** A full EffectiveMailConfig (enabled defaults) the caller would hand through. */
  function effCfg(overrides: Partial<EffectiveMailConfig> = {}): EffectiveMailConfig {
    return {
      enabled: true,
      effectiveEnabled: true,
      host: 'smtp.override.example',
      port: 2525,
      secure: false,
      user: '',
      pass: '',
      from: DEFAULT_FROM,
      language: 'en',
      subjectTemplate: '',
      hasPassword: false,
      passwordDecryptable: false,
      ...overrides,
    };
  }

  it('uses an ENABLED override and does NOT read the settings again (getEffectiveMailConfig + DB untouched)', async () => {
    const send = mockTransport(jest.fn().mockResolvedValue({ messageId: 'x' }));

    await expect(
      sendMail(
        { to: 'alice@example.com', subject: 'Hello', text: 'Body' },
        effCfg({ host: 'smtp.override.example', port: 2525 })
      )
    ).resolves.toBe(true);

    // The whole point of FIX 4: no second settings read of any kind.
    expect(cfgSpy).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
    // Transport is built from the OVERRIDE config and the send still happens.
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.override.example', port: 2525, secure: false })
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'alice@example.com', subject: 'Hello', text: 'Body' })
    );
  });

  it('authenticates with the override credentials when a user is set — and still never reads again', async () => {
    mockTransport(jest.fn().mockResolvedValue({}));

    await expect(
      sendMail(
        { to: 'alice@example.com', subject: 'Hi', text: 'Body' },
        effCfg({ user: 'relay-user', pass: 'override-pass' })
      )
    ).resolves.toBe(true);

    expect(cfgSpy).not.toHaveBeenCalled();
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: 'relay-user', pass: 'override-pass' } })
    );
  });

  it('honors a DISABLED override: log-only [MAIL disabled], resolves true, no socket, no re-read', async () => {
    await expect(
      sendMail(
        { to: 'alice@example.com', subject: 'Hello', text: 'Body' },
        effCfg({ enabled: false, effectiveEnabled: false })
      )
    ).resolves.toBe(true);

    expect(cfgSpy).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
    expect(createTransport).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('[MAIL disabled] to=alice@example.com subject=Hello');
  });

  it('still sanitizes the subject on the override path (header/log-injection defense preserved)', async () => {
    const CR = String.fromCharCode(13);
    const LF = String.fromCharCode(10);
    const send = mockTransport(jest.fn().mockResolvedValue({}));

    await expect(
      sendMail(
        { to: 'alice@example.com', subject: `Legit${CR}${LF}Bcc: evil@x.com`, text: 'Body' },
        effCfg()
      )
    ).resolves.toBe(true);

    const sentSubject = send.mock.calls[0][0].subject as string;
    expect(sentSubject).not.toContain(CR);
    expect(sentSubject).not.toContain(LF);
    expect(sentSubject).toBe('Legit Bcc: evil@x.com');
  });

  it('WITHOUT an override still reads the settings itself (unchanged self-read behavior)', async () => {
    findUnique.mockResolvedValue(doc({ enabled: true, host: 'smtp.corp.example' }));
    mockTransport(jest.fn().mockResolvedValue({}));

    await expect(
      sendMail({ to: 'alice@example.com', subject: 'Hello', text: 'Body' })
    ).resolves.toBe(true);

    // The self-read path runs: getEffectiveMailConfig IS invoked, which reads the DB.
    expect(cfgSpy).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// utils/mailer.ts — sendTestMail(): STRUCTURED diagnostic result for the ADMIN
// "Send test email" button. Mirrors sendMail's config-read + transport-build but
// returns { status } instead of a boolean, and maps a failure to a FIXED reason
// category (never any secret- or error-derived text).
// ---------------------------------------------------------------------------
describe('sendTestMail (disabled / not sent)', () => {
  it('returns { status: disabled } and opens NO socket when disabled (no document)', async () => {
    findUnique.mockResolvedValue(null);
    await expect(sendTestMail('ops@corp.example')).resolves.toEqual({ status: 'disabled' });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('treats enabled-but-no-host as disabled (no transport, no socket)', async () => {
    findUnique.mockResolvedValue(doc({ enabled: true, host: '' }));
    await expect(sendTestMail('ops@corp.example')).resolves.toEqual({ status: 'disabled' });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('returns { status: failed, reason: config_error } when the settings read throws (no socket)', async () => {
    findUnique.mockRejectedValue(new Error('mongo unreachable'));
    await expect(sendTestMail('ops@corp.example')).resolves.toEqual({
      status: 'failed',
      reason: 'config_error',
    });
    expect(createTransport).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[MAIL] test settings read failed'),
      expect.anything()
    );
  });
});

describe('sendTestMail (real send path)', () => {
  it('returns { status: sent } and builds the same transport shape as a real send', async () => {
    findUnique.mockResolvedValue(doc({ enabled: true, host: 'smtp.corp.example', port: 2525 }));
    const send = mockTransport(jest.fn().mockResolvedValue({ messageId: 'x' }));

    await expect(sendTestMail('ops@corp.example')).resolves.toEqual({ status: 'sent' });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.corp.example', port: 2525, secure: false })
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ops@corp.example', subject: '[IdeaHub] Test email' })
    );
  });

  it('authenticates with the decrypted password when a username is configured', async () => {
    findUnique.mockResolvedValue(
      doc({
        enabled: true,
        host: 'smtp.corp.example',
        username: 'relay-user',
        passwordEnc: encrypt('relay-pass'),
      })
    );
    mockTransport(jest.fn().mockResolvedValue({}));

    await expect(sendTestMail('ops@corp.example')).resolves.toEqual({ status: 'sent' });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: 'relay-user', pass: 'relay-pass' } })
    );
  });
});

describe('sendTestMail (error -> fixed reason category)', () => {
  beforeEach(() => {
    findUnique.mockResolvedValue(doc({ enabled: true, host: 'smtp.corp.example' }));
  });

  // Each thrown error's .code (the nodemailer "type") maps to exactly one fixed
  // MailFailureReason. These are the documented codes; the ESOCKET-with-errno
  // recovery (nodemailer's real refused-connection shape) is exercised below.
  const codeCases: Array<[string, string]> = [
    ['EAUTH', 'auth_failed'],
    ['ECONNREFUSED', 'connection_refused'],
    ['ETIMEDOUT', 'timeout'],
    ['EDNS', 'host_not_found'],
    ['ENOTFOUND', 'host_not_found'],
    ['EAI_AGAIN', 'host_not_found'],
    ['ESOCKET', 'tls_error'], // no errno -> genuine TLS/socket error
    ['ETLS', 'tls_error'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls_error'],
    ['ERR_SSL_WRONG_VERSION_NUMBER', 'tls_error'],
    ['EENVELOPE', 'unknown'],
    ['ESOMETHINGELSE', 'unknown'],
  ];

  for (const [code, reason] of codeCases) {
    it(`maps code ${code} -> reason ${reason}`, async () => {
      const err: any = new Error(`boom ${code}`);
      err.code = code;
      mockTransport(jest.fn().mockRejectedValue(err));

      await expect(sendTestMail('ops@corp.example')).resolves.toEqual({
        status: 'failed',
        reason,
      });
      // The full error is ALWAYS logged server-side (operators keep the detail).
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[MAIL] test send failed'),
        err
      );
    });
  }

  it('maps a plain Error with no .code to reason unknown', async () => {
    mockTransport(jest.fn().mockRejectedValue(new Error('mystery failure')));
    await expect(sendTestMail('ops@corp.example')).resolves.toEqual({
      status: 'failed',
      reason: 'unknown',
    });
  });

  it('recovers a refused connection that nodemailer masked as ESOCKET (real shape) -> connection_refused', async () => {
    // nodemailer relabels a refused TCP connect as code ESOCKET but leaves the OS
    // errno on the error; util.getSystemErrorName(errno) recovers ECONNREFUSED.
    const err: any = new Error('connect ECONNREFUSED 127.0.0.1:1');
    err.code = 'ESOCKET';
    err.errno = -Math.abs(os.constants.errno.ECONNREFUSED); // portable libuv errno
    err.syscall = 'connect';
    mockTransport(jest.fn().mockRejectedValue(err));

    await expect(sendTestMail('ops@corp.example')).resolves.toEqual({
      status: 'failed',
      reason: 'connection_refused',
    });
  });

  it('recovers a timeout masked as ESOCKET via the system errno -> timeout', async () => {
    const err: any = new Error('socket ETIMEDOUT');
    err.code = 'ESOCKET';
    err.errno = -Math.abs(os.constants.errno.ETIMEDOUT);
    mockTransport(jest.fn().mockRejectedValue(err));

    await expect(sendTestMail('ops@corp.example')).resolves.toEqual({
      status: 'failed',
      reason: 'timeout',
    });
  });
});

// ---------------------------------------------------------------------------
// SECURITY: the SMTP password / username / host must NEVER leak into the result
// the route serializes back to the client — only the fixed reason category may.
// Force a realistic EAUTH failure whose message/response/command embed sentinel
// secrets AND configure a real (encrypted) sentinel password, then assert the
// serialized MailTestResult carries the category and NONE of the sentinels.
// (The route does `res.json(result)`, so JSON.stringify(result) IS the body.)
// ---------------------------------------------------------------------------
describe('sendTestMail (SECURITY: no secret leaks into the structured result)', () => {
  const SENTINEL_PASSWORD = 'S3NTINEL-PASSWORD-do-not-leak-42';
  const SENTINEL_USERNAME = 'sentinel-relay-username';
  const SENTINEL_HOST = 'sentinel-smtp-host.internal';

  it('an EAUTH failure returns only { status: failed, reason: auth_failed } with no config or error text', async () => {
    findUnique.mockResolvedValue(
      doc({
        enabled: true,
        host: SENTINEL_HOST,
        username: SENTINEL_USERNAME,
        passwordEnc: encrypt(SENTINEL_PASSWORD),
      })
    );

    // A nodemailer-shaped auth error that embeds the sentinels in the very fields
    // (message/response/command) a naive implementation might forward to the client.
    const eauth: any = new Error(
      `Invalid login: 535 auth failed for ${SENTINEL_USERNAME}/${SENTINEL_PASSWORD} at ${SENTINEL_HOST}`
    );
    eauth.code = 'EAUTH';
    eauth.response = `535 5.7.8 bad credentials user=${SENTINEL_USERNAME} pass=${SENTINEL_PASSWORD}`;
    eauth.responseCode = 535;
    eauth.command = 'AUTH LOGIN';
    mockTransport(jest.fn().mockRejectedValue(eauth));

    const result = await sendTestMail('ops@corp.example');

    // Correct category...
    expect(result).toEqual({ status: 'failed', reason: 'auth_failed' });

    // ...and the serialized result (== the /test response body) leaks NOTHING.
    const serialized = JSON.stringify(result);
    expect(serialized).toContain('auth_failed');
    expect(serialized).not.toContain(SENTINEL_PASSWORD);
    expect(serialized).not.toContain(SENTINEL_USERNAME);
    expect(serialized).not.toContain(SENTINEL_HOST);
    expect(serialized).not.toContain('535');
    expect(serialized).not.toContain('AUTH LOGIN');

    // The full error IS still logged server-side (detail is preserved, not hidden).
    const logged = errorSpy.mock.calls.find((c) => String(c[0]).includes('[MAIL] test send failed'));
    expect(logged).toBeDefined();
    expect(logged![1]).toBe(eauth);
    expect(String((logged![1] as Error).message)).toContain(SENTINEL_PASSWORD);
  });
});
