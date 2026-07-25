// Unit coverage for the best-effort mail infrastructure:
//   - utils/mailer.ts   (sendMail: never throws, log-only when disabled)
//   - config/mail.ts    (lazy getters + pure validateMailConfig)
//
// nodemailer is fully mocked (an explicit factory keeps the esModuleInterop
// default-import happy across ts-jest). Config is read lazily from process.env,
// so each test sets env then calls — mirroring the SSO suite's env save/restore.

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

import nodemailer from 'nodemailer';
import { sendMail } from '../utils/mailer';
import { getMailConfig, validateMailConfig, isMailEnabled } from '../config/mail';

const createTransport = nodemailer.createTransport as jest.Mock;

const DEFAULT_FROM = 'IdeaHub <no-reply@ideahub.local>';

// Every env var the mail module reads. Saved once, restored after the suite so
// this file never leaks config into sibling suites in the same worker.
const MAIL_ENV_KEYS = [
  'MAIL_ENABLED',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'MAIL_FROM',
];
const savedEnv: Record<string, string | undefined> = {};

let logSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

/** Wire createTransport to a fresh sendMail mock and return it. */
function mockTransport(sendImpl: jest.Mock): jest.Mock {
  createTransport.mockReturnValue({ sendMail: sendImpl });
  return sendImpl;
}

beforeAll(() => {
  for (const k of MAIL_ENV_KEYS) savedEnv[k] = process.env[k];
});

afterAll(() => {
  for (const k of MAIL_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

beforeEach(() => {
  // Clean slate: every mail var unset -> disabled defaults.
  for (const k of MAIL_ENV_KEYS) delete process.env[k];
  createTransport.mockReset();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// config/mail.ts — getMailConfig()
// ---------------------------------------------------------------------------
describe('getMailConfig', () => {
  it('returns disabled defaults when nothing is set', () => {
    const cfg = getMailConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.effectiveEnabled).toBe(false);
    expect(cfg.host).toBe('');
    expect(cfg.port).toBe(587);
    expect(cfg.secure).toBe(false);
    expect(cfg.user).toBe('');
    expect(cfg.pass).toBe('');
    expect(cfg.from).toBe(DEFAULT_FROM);
  });

  it('reads host/port/secure/user/pass/from from the environment', () => {
    process.env.MAIL_ENABLED = 'true';
    process.env.SMTP_HOST = 'smtp.corp.example';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_SECURE = 'true';
    process.env.SMTP_USER = 'relay-user';
    process.env.SMTP_PASS = 'relay-pass';
    process.env.MAIL_FROM = 'Ideas <ideas@corp.example>';

    const cfg = getMailConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.effectiveEnabled).toBe(true);
    expect(cfg.host).toBe('smtp.corp.example');
    expect(cfg.port).toBe(465);
    expect(cfg.secure).toBe(true);
    expect(cfg.user).toBe('relay-user');
    expect(cfg.pass).toBe('relay-pass');
    expect(cfg.from).toBe('Ideas <ideas@corp.example>');
  });

  it('falls back to port 587 when SMTP_PORT is non-numeric', () => {
    process.env.SMTP_PORT = 'not-a-port';
    expect(getMailConfig().port).toBe(587);
  });

  it('is effectiveEnabled only when enabled AND a host is present', () => {
    process.env.MAIL_ENABLED = 'true';
    process.env.SMTP_HOST = 'smtp.corp.example';
    expect(getMailConfig().effectiveEnabled).toBe(true);
  });

  it('is NOT effectiveEnabled when enabled but SMTP_HOST is missing', () => {
    process.env.MAIL_ENABLED = 'true';
    const cfg = getMailConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.effectiveEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// config/mail.ts — isMailEnabled()
// ---------------------------------------------------------------------------
describe('isMailEnabled', () => {
  it('only the exact string "true" enables mail', () => {
    process.env.MAIL_ENABLED = 'true';
    expect(isMailEnabled()).toBe(true);

    for (const v of ['TRUE', 'True', '1', 'yes', 'on', '']) {
      process.env.MAIL_ENABLED = v;
      expect(isMailEnabled()).toBe(false);
    }
    delete process.env.MAIL_ENABLED;
    expect(isMailEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// config/mail.ts — validateMailConfig()
// ---------------------------------------------------------------------------
describe('validateMailConfig', () => {
  it('is ok when disabled, regardless of other vars', () => {
    // Deliberately set a broken-looking combo — disabled short-circuits it.
    process.env.SMTP_HOST = '';
    process.env.SMTP_USER = 'u';
    const status = validateMailConfig();
    expect(status.ok).toBe(true);
    expect(status.fatal).toBeUndefined();
    expect(status.warnings).toEqual([]);
  });

  it('returns a fatal-shaped result when enabled but SMTP_HOST is missing', () => {
    process.env.MAIL_ENABLED = 'true';
    const status = validateMailConfig();
    expect(status.ok).toBe(false);
    expect(status.fatal).toContain('SMTP_HOST');
    expect(status.warnings).toEqual([]);
  });

  it('is ok when enabled with a host present', () => {
    process.env.MAIL_ENABLED = 'true';
    process.env.SMTP_HOST = 'smtp.corp.example';
    const status = validateMailConfig();
    expect(status.ok).toBe(true);
    expect(status.fatal).toBeUndefined();
    expect(status.warnings).toEqual([]);
  });

  it('warns when SMTP_USER is set but SMTP_PASS is empty', () => {
    process.env.MAIL_ENABLED = 'true';
    process.env.SMTP_HOST = 'smtp.corp.example';
    process.env.SMTP_USER = 'relay-user';
    const status = validateMailConfig();
    expect(status.ok).toBe(true);
    expect(status.fatal).toBeUndefined();
    expect(status.warnings).toHaveLength(1);
    expect(status.warnings[0]).toContain('SMTP_PASS');
  });
});

// ---------------------------------------------------------------------------
// utils/mailer.ts — sendMail() disabled / effective-disabled (log-only)
// ---------------------------------------------------------------------------
describe('sendMail (disabled / log-only)', () => {
  it('resolves true and never builds a transport when mail is disabled (default)', async () => {
    await expect(
      sendMail({ to: 'alice@example.com', subject: 'Hello', text: 'Body' })
    ).resolves.toBe(true);

    expect(createTransport).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      '[MAIL disabled] to=alice@example.com subject=Hello'
    );
  });

  it('treats enabled-but-no-host as disabled (effective-disabled, no transport)', async () => {
    process.env.MAIL_ENABLED = 'true'; // enabled flag on, but SMTP_HOST missing

    await expect(
      sendMail({ to: 'alice@example.com', subject: 'Hello', text: 'Body' })
    ).resolves.toBe(true);

    expect(createTransport).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      '[MAIL disabled] to=alice@example.com subject=Hello'
    );
  });

  it('joins an array of recipients for the disabled log line', async () => {
    await expect(
      sendMail({ to: ['a@x.com', 'b@y.com'], subject: 'Hi', text: 'Body' })
    ).resolves.toBe(true);

    expect(logSpy).toHaveBeenCalledWith(
      '[MAIL disabled] to=a@x.com, b@y.com subject=Hi'
    );
  });
});

// ---------------------------------------------------------------------------
// utils/mailer.ts — sendMail() enabled (real transport path)
// ---------------------------------------------------------------------------
describe('sendMail (enabled)', () => {
  beforeEach(() => {
    process.env.MAIL_ENABLED = 'true';
    process.env.SMTP_HOST = 'smtp.corp.example';
    process.env.SMTP_PORT = '2525';
  });

  it('creates a transport with host/port/secure and NO auth when SMTP_USER is unset', async () => {
    const send = mockTransport(jest.fn().mockResolvedValue({ messageId: 'x' }));

    await expect(
      sendMail({ to: 'alice@example.com', subject: 'Hello', text: 'Body' })
    ).resolves.toBe(true);

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.corp.example', port: 2525, secure: false })
    );
    // Auth must be absent for an IP-allowlisted relay.
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

  it('includes an auth object only when SMTP_USER is set', async () => {
    process.env.SMTP_USER = 'relay-user';
    process.env.SMTP_PASS = 'relay-pass';
    mockTransport(jest.fn().mockResolvedValue({}));

    await sendMail({ to: 'alice@example.com', subject: 'Hello', text: 'Body' });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: 'relay-user', pass: 'relay-pass' } })
    );
  });

  it('passes SMTP_SECURE=true through as implicit TLS', async () => {
    process.env.SMTP_SECURE = 'true';
    mockTransport(jest.fn().mockResolvedValue({}));

    await sendMail({ to: 'alice@example.com', subject: 'Hello', text: 'Body' });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true })
    );
  });

  it('forwards an array of recipients unchanged to sendMail', async () => {
    const send = mockTransport(jest.fn().mockResolvedValue({}));

    await sendMail({ to: ['a@x.com', 'b@y.com'], subject: 'Hi', text: 'Body' });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['a@x.com', 'b@y.com'] })
    );
  });

  it('includes html only when provided', async () => {
    const send = mockTransport(jest.fn().mockResolvedValue({}));

    await sendMail({
      to: 'alice@example.com',
      subject: 'Hello',
      text: 'Body',
      html: '<p>Body</p>',
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ html: '<p>Body</p>' })
    );
  });
});

// ---------------------------------------------------------------------------
// utils/mailer.ts — sendMail() failure paths (best-effort: never throws)
// ---------------------------------------------------------------------------
describe('sendMail (failure is swallowed)', () => {
  beforeEach(() => {
    process.env.MAIL_ENABLED = 'true';
    process.env.SMTP_HOST = 'smtp.corp.example';
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
