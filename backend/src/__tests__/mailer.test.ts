// Unit coverage for the best-effort mail infrastructure after the DB-backed
// rework:
//   - config/mail.ts   (async getEffectiveMailConfig over the singleton settings)
//   - utils/mailer.ts  (sendMail: never throws; log-only when disabled; async)
//
// Prisma is mocked at the @prisma/client boundary (so lib/prisma resolves to the
// mock) to control the single MailSettings document. nodemailer is mocked. The
// REAL secretbox is used with a fixed test key so decryption is genuine.

const mockPrisma: { mailSettings: { findFirst: jest.Mock } } = {
  mailSettings: { findFirst: jest.fn() },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
}));

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

import nodemailer from 'nodemailer';
import { sendMail } from '../utils/mailer';
import { getEffectiveMailConfig } from '../config/mail';
import { encrypt } from '../utils/secretbox';

const createTransport = nodemailer.createTransport as jest.Mock;
const findFirst = mockPrisma.mailSettings.findFirst;

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
  findFirst.mockReset();
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
    findFirst.mockResolvedValue(null);
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
    findFirst.mockResolvedValue(
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
    findFirst.mockResolvedValue(doc({ enabled: true, host: '' }));
    const cfg = await getEffectiveMailConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.effectiveEnabled).toBe(false);
  });

  it('decrypts a stored password (roundtrip via the real secretbox)', async () => {
    findFirst.mockResolvedValue(
      doc({ enabled: true, host: 'h', username: 'u', passwordEnc: encrypt('relay-pass') })
    );
    const cfg = await getEffectiveMailConfig();
    expect(cfg.pass).toBe('relay-pass');
    expect(cfg.hasPassword).toBe(true);
    expect(cfg.passwordDecryptable).toBe(true);
  });

  it('tolerates an undecryptable stored password (null-safe, no throw)', async () => {
    findFirst.mockResolvedValue(
      doc({ enabled: true, host: 'h', username: 'u', passwordEnc: 'not-valid-ciphertext' })
    );
    const cfg = await getEffectiveMailConfig();
    expect(cfg.pass).toBe('');
    expect(cfg.hasPassword).toBe(true);
    expect(cfg.passwordDecryptable).toBe(false);
  });

  it('normalizes the language (sk kept; unknown falls back to en)', async () => {
    findFirst.mockResolvedValue(doc({ language: 'sk' }));
    expect((await getEffectiveMailConfig()).language).toBe('sk');
    findFirst.mockResolvedValue(doc({ language: 'de' }));
    expect((await getEffectiveMailConfig()).language).toBe('en');
  });

  it('treats a whitespace-only subjectTemplate as empty (built-in subject)', async () => {
    findFirst.mockResolvedValue(doc({ subjectTemplate: '   ' }));
    expect((await getEffectiveMailConfig()).subjectTemplate).toBe('');
  });
});

// ---------------------------------------------------------------------------
// utils/mailer.ts — sendMail() disabled / effective-disabled (log-only)
// ---------------------------------------------------------------------------
describe('sendMail (disabled / log-only)', () => {
  it('resolves true and never builds a transport when disabled (no document)', async () => {
    findFirst.mockResolvedValue(null);
    await expect(
      sendMail({ to: 'alice@example.com', subject: 'Hello', text: 'Body' })
    ).resolves.toBe(true);
    expect(createTransport).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('[MAIL disabled] to=alice@example.com subject=Hello');
  });

  it('treats enabled-but-no-host as disabled (no transport)', async () => {
    findFirst.mockResolvedValue(doc({ enabled: true, host: '' }));
    await expect(
      sendMail({ to: 'alice@example.com', subject: 'Hello', text: 'Body' })
    ).resolves.toBe(true);
    expect(createTransport).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('[MAIL disabled] to=alice@example.com subject=Hello');
  });

  it('joins an array of recipients for the disabled log line', async () => {
    findFirst.mockResolvedValue(null);
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
    findFirst.mockResolvedValue(doc({ enabled: true, host: 'smtp.corp.example', port: 2525 }));
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
    findFirst.mockResolvedValue(
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
    findFirst.mockResolvedValue(doc({ enabled: true, host: 'smtp.corp.example', secure: true }));
    mockTransport(jest.fn().mockResolvedValue({}));

    await sendMail({ to: 'alice@example.com', subject: 'Hello', text: 'Body' });

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true }));
  });

  it('forwards an array of recipients unchanged to sendMail', async () => {
    findFirst.mockResolvedValue(doc({ enabled: true, host: 'smtp.corp.example' }));
    const send = mockTransport(jest.fn().mockResolvedValue({}));

    await sendMail({ to: ['a@x.com', 'b@y.com'], subject: 'Hi', text: 'Body' });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ['a@x.com', 'b@y.com'] }));
  });

  it('includes html only when provided', async () => {
    findFirst.mockResolvedValue(doc({ enabled: true, host: 'smtp.corp.example' }));
    const send = mockTransport(jest.fn().mockResolvedValue({}));

    await sendMail({ to: 'alice@example.com', subject: 'Hello', text: 'Body', html: '<p>Body</p>' });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ html: '<p>Body</p>' }));
  });

  it('warns (without logging the secret) on an undecryptable stored password and sends without it', async () => {
    findFirst.mockResolvedValue(
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
    findFirst.mockResolvedValue(doc({ enabled: true, host: 'smtp.corp.example' }));
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
    findFirst.mockResolvedValue(null); // disabled -> log-only path, no transport

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
    findFirst.mockResolvedValue(doc({ enabled: true, host: 'smtp.corp.example' }));
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
    findFirst.mockRejectedValue(new Error('mongo unreachable'));

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
