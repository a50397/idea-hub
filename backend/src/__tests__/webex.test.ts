// Unit coverage for the Webex notification channel:
//   - utils/webex.ts getEffectiveWebexConfig()  (async, over the singleton settings)
//   - utils/webex.ts sendWebexMessage()          (never throws; log-only when off)
//   - utils/webex.ts sendTestWebexMessage()      (structured { ok, reason } result)
//
// Prisma is mocked at the @prisma/client boundary (so lib/prisma resolves to the
// mock) to control the single WebexSettings document. The global fetch is mocked so
// no real HTTP happens. The REAL secretbox is used with a fixed test key so the bot
// token decryption is genuine.

const mockPrisma: { webexSettings: { findUnique: jest.Mock } } = {
  webexSettings: { findUnique: jest.fn() },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
}));

import {
  getEffectiveWebexConfig,
  sendWebexMessage,
  sendTestWebexMessage,
  listWebexRooms,
  type EffectiveWebexConfig,
  type WebexFailureReason,
  type SendWebexOptions,
} from '../utils/webex';
import { encrypt } from '../utils/secretbox';

const findUnique = mockPrisma.webexSettings.findUnique;

// 64 hex chars == 32 bytes (the documented hex key form; same as the mailer suite).
const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const DEFAULT_BASE = 'https://webexapis.com';

// The CLOSED set of reason categories the diagnostic test-send may return. Used as
// the no-leak regression guard: a returned reason is ALWAYS a member of this fixed
// enum, never a raw cause code / HTTP status / response-body string.
const FIXED_WEBEX_REASONS: readonly WebexFailureReason[] = [
  'invalid_token',
  'recipient_not_found',
  'rate_limited',
  'timeout',
  'host_not_found',
  'connection_refused',
  'tls_error',
  'connection_failed',
  'config_error',
  'unknown',
];

let savedKey: string | undefined;
let savedBase: string | undefined;
let fetchMock: jest.Mock;
let logSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;

/** Build a WebexSettings-shaped document with disabled defaults + overrides. */
function doc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'settings1',
    singleton: 'singleton',
    enabled: false,
    botTokenEnc: null,
    language: 'sk',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** A minimal Response-like object honoring the fields the sender reads. */
function response(init: { ok: boolean; status: number; body?: string }): Response {
  return {
    ok: init.ok,
    status: init.status,
    text: async () => init.body ?? '',
  } as unknown as Response;
}

/**
 * A Response-like object honoring `json()`, which the rooms-listing parse path reads
 * (unlike the message-send path, which reads only `text()` on a 400). When `json` is
 * omitted, `json()` rejects — modeling a non-JSON body the parser must tolerate.
 */
function roomsResponse(init: { ok: boolean; status: number; json?: unknown }): Response {
  return {
    ok: init.ok,
    status: init.status,
    json: async () => {
      if (init.json === undefined) throw new Error('not json');
      return init.json;
    },
    text: async () => '',
  } as unknown as Response;
}

/** A full EffectiveWebexConfig (enabled defaults) a caller would hand through. */
function effCfg(overrides: Partial<EffectiveWebexConfig> = {}): EffectiveWebexConfig {
  return {
    enabled: true,
    effectiveEnabled: true,
    token: 'override-token',
    language: 'sk',
    hasToken: true,
    tokenDecryptable: true,
    ...overrides,
  };
}

beforeAll(() => {
  savedKey = process.env.MAIL_SETTINGS_KEY;
  savedBase = process.env.WEBEX_API_BASE_URL;
  process.env.MAIL_SETTINGS_KEY = TEST_KEY;
});

afterAll(() => {
  if (savedKey === undefined) delete process.env.MAIL_SETTINGS_KEY;
  else process.env.MAIL_SETTINGS_KEY = savedKey;
  if (savedBase === undefined) delete process.env.WEBEX_API_BASE_URL;
  else process.env.WEBEX_API_BASE_URL = savedBase;
});

beforeEach(() => {
  findUnique.mockReset();
  delete process.env.WEBEX_API_BASE_URL; // hermetic default origin unless a test opts in
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
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
// getEffectiveWebexConfig()
// ---------------------------------------------------------------------------
describe('getEffectiveWebexConfig', () => {
  it('returns disabled defaults (sk) when no settings document exists', async () => {
    findUnique.mockResolvedValue(null);
    const cfg = await getEffectiveWebexConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.effectiveEnabled).toBe(false);
    expect(cfg.token).toBe('');
    expect(cfg.language).toBe('sk');
    expect(cfg.hasToken).toBe(false);
    expect(cfg.tokenDecryptable).toBe(false);
  });

  it('is effectiveEnabled and decrypts the token when enabled with a usable token', async () => {
    findUnique.mockResolvedValue(doc({ enabled: true, botTokenEnc: encrypt('bot-token-xyz'), language: 'en' }));
    const cfg = await getEffectiveWebexConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.effectiveEnabled).toBe(true);
    expect(cfg.token).toBe('bot-token-xyz');
    expect(cfg.language).toBe('en');
    expect(cfg.hasToken).toBe(true);
    expect(cfg.tokenDecryptable).toBe(true);
  });

  it('is enabled but NOT effectiveEnabled when no token is stored', async () => {
    findUnique.mockResolvedValue(doc({ enabled: true, botTokenEnc: null }));
    const cfg = await getEffectiveWebexConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.effectiveEnabled).toBe(false);
    expect(cfg.hasToken).toBe(false);
  });

  it('is NOT effectiveEnabled when a stored token cannot be decrypted (wrong/rotated key)', async () => {
    findUnique.mockResolvedValue(doc({ enabled: true, botTokenEnc: 'not-valid-ciphertext' }));
    const cfg = await getEffectiveWebexConfig();
    expect(cfg.effectiveEnabled).toBe(false);
    expect(cfg.token).toBe('');
    expect(cfg.hasToken).toBe(true);
    expect(cfg.tokenDecryptable).toBe(false);
  });

  it('normalizes the language (en kept; unknown falls back to the sk default)', async () => {
    findUnique.mockResolvedValue(doc({ language: 'en' }));
    expect((await getEffectiveWebexConfig()).language).toBe('en');
    findUnique.mockResolvedValue(doc({ language: 'de' }));
    expect((await getEffectiveWebexConfig()).language).toBe('sk');
  });

  it('is not effectiveEnabled when disabled even with a usable token', async () => {
    findUnique.mockResolvedValue(doc({ enabled: false, botTokenEnc: encrypt('bot-token-xyz') }));
    const cfg = await getEffectiveWebexConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.effectiveEnabled).toBe(false);
    expect(cfg.hasToken).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sendWebexMessage() — disabled / log-only (no network call)
// ---------------------------------------------------------------------------
describe('sendWebexMessage (disabled / log-only)', () => {
  it('resolves true and never calls fetch when disabled (no document)', async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      sendWebexMessage({ toPersonEmail: 'alice@example.com', markdown: 'hi' })
    ).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('[WEBEX disabled] to=alice@example.com');
  });

  it('treats enabled-but-no-token as disabled (no fetch)', async () => {
    findUnique.mockResolvedValue(doc({ enabled: true, botTokenEnc: null }));
    await expect(
      sendWebexMessage({ toPersonEmail: 'alice@example.com', markdown: 'hi' })
    ).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('warns (without logging the token) on an undecryptable stored token and does not fetch', async () => {
    findUnique.mockResolvedValue(doc({ enabled: true, botTokenEnc: 'garbage-that-will-not-decrypt' }));
    await expect(
      sendWebexMessage({ toPersonEmail: 'alice@example.com', markdown: 'hi' })
    ).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('MAIL_SETTINGS_KEY');
  });
});

// ---------------------------------------------------------------------------
// sendWebexMessage() — enabled (real fetch path)
// ---------------------------------------------------------------------------
describe('sendWebexMessage (enabled)', () => {
  beforeEach(() => {
    findUnique.mockResolvedValue(doc({ enabled: true, botTokenEnc: encrypt('bot-token-xyz') }));
  });

  it('POSTs a 1:1 DM to the default origin with Bearer auth and a toPersonEmail/markdown body', async () => {
    fetchMock.mockResolvedValue(response({ ok: true, status: 200 }));

    await expect(
      sendWebexMessage({ toPersonEmail: 'alice@example.com', markdown: '**hi**' })
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${DEFAULT_BASE}/v1/messages`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer bot-token-xyz');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ toPersonEmail: 'alice@example.com', markdown: '**hi**' });
    // A ~10s AbortSignal guards the request.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('honors a WEBEX_API_BASE_URL override (trailing slash trimmed)', async () => {
    process.env.WEBEX_API_BASE_URL = 'https://webex.proxy.internal/';
    fetchMock.mockResolvedValue(response({ ok: true, status: 200 }));

    await sendWebexMessage({ toPersonEmail: 'alice@example.com', markdown: 'hi' });

    expect(fetchMock.mock.calls[0][0]).toBe('https://webex.proxy.internal/v1/messages');
  });

  it('resolves false and logs (status only, no token) when the response is not ok', async () => {
    fetchMock.mockResolvedValue(response({ ok: false, status: 502 }));

    await expect(
      sendWebexMessage({ toPersonEmail: 'alice@example.com', markdown: 'hi' })
    ).resolves.toBe(false);

    expect(errorSpy).toHaveBeenCalledWith('[WEBEX] send failed to=alice@example.com status=502');
    // The token never appears in any log line.
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('bot-token-xyz');
    }
  });

  it('resolves false and logs when fetch rejects (network error)', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      sendWebexMessage({ toPersonEmail: 'alice@example.com', markdown: 'hi' })
    ).resolves.toBe(false);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[WEBEX] send failed'),
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// sendWebexMessage() — room/space target (roomId instead of toPersonEmail)
//
// The SAME POST /v1/messages endpoint, but the body carries `roomId` (a space post)
// instead of `toPersonEmail` (a 1:1 DM), and every log line names `room=<id>`. The
// token is never in the body or any log line.
// ---------------------------------------------------------------------------
describe('sendWebexMessage (room target)', () => {
  beforeEach(() => {
    findUnique.mockResolvedValue(doc({ enabled: true, botTokenEnc: encrypt('bot-token-xyz') }));
  });

  it('POSTs a room message whose body carries roomId/markdown (NOT toPersonEmail)', async () => {
    fetchMock.mockResolvedValue(response({ ok: true, status: 200 }));

    await expect(
      sendWebexMessage({ roomId: 'ROOM-123', markdown: '**hi**' })
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${DEFAULT_BASE}/v1/messages`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer bot-token-xyz');
    const body = JSON.parse(init.body);
    // The target is a room post: roomId is present and toPersonEmail is absent.
    expect(body).toEqual({ roomId: 'ROOM-123', markdown: '**hi**' });
    expect(body).not.toHaveProperty('toPersonEmail');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('logs the room target (room=<id>) — never the token — on a non-ok response', async () => {
    fetchMock.mockResolvedValue(response({ ok: false, status: 502 }));

    await expect(
      sendWebexMessage({ roomId: 'ROOM-err', markdown: 'hi' })
    ).resolves.toBe(false);

    expect(errorSpy).toHaveBeenCalledWith('[WEBEX] send failed room=ROOM-err status=502');
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('bot-token-xyz');
    }
  });

  it('disabled: logs a room= disabled line, resolves true, and never calls fetch', async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      sendWebexMessage({ roomId: 'ROOM-off', markdown: 'hi' })
    ).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('[WEBEX disabled] room=ROOM-off');
  });
});

// ---------------------------------------------------------------------------
// sendWebexMessage() — settings read failure (DB down): best-effort false
// ---------------------------------------------------------------------------
describe('sendWebexMessage (settings read failure)', () => {
  it('resolves false and logs, never calling fetch, when the settings read rejects', async () => {
    findUnique.mockRejectedValue(new Error('mongo unreachable'));

    await expect(
      sendWebexMessage({ toPersonEmail: 'alice@example.com', markdown: 'hi' })
    ).resolves.toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[WEBEX] settings read failed'),
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// sendWebexMessage() — no-target defensive guard
//
// The SendWebexOptions discriminated union should make this unreachable from typed
// callers, but a caller reaching PAST the types (neither field) must NEVER cause an
// empty recipient to be POSTed: bail with false, log, and touch no settings read /
// network call.
// ---------------------------------------------------------------------------
describe('sendWebexMessage (no target)', () => {
  it('returns false, logs, and never reads settings or calls fetch when neither target is present', async () => {
    await expect(
      sendWebexMessage({ markdown: 'hi' } as unknown as SendWebexOptions)
    ).resolves.toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('[WEBEX] send called with no target');
  });
});

// ---------------------------------------------------------------------------
// sendWebexMessage() — caller-provided config override (single read)
// ---------------------------------------------------------------------------
describe('sendWebexMessage (caller-provided config override — single read)', () => {
  it('uses an ENABLED override and does NOT read the settings again (findUnique untouched)', async () => {
    fetchMock.mockResolvedValue(response({ ok: true, status: 200 }));

    await expect(
      sendWebexMessage(
        { toPersonEmail: 'alice@example.com', markdown: 'hi' },
        effCfg({ token: 'handed-through-token' })
      )
    ).resolves.toBe(true);

    expect(findUnique).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer handed-through-token');
  });

  it('honors a DISABLED override: log-only, resolves true, no fetch, no read', async () => {
    await expect(
      sendWebexMessage(
        { toPersonEmail: 'alice@example.com', markdown: 'hi' },
        effCfg({ enabled: false, effectiveEnabled: false })
      )
    ).resolves.toBe(true);

    expect(findUnique).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('[WEBEX disabled] to=alice@example.com');
  });
});

// ---------------------------------------------------------------------------
// sendTestWebexMessage() — disabled / not sent (config_error, no network call)
// ---------------------------------------------------------------------------
describe('sendTestWebexMessage (disabled / not sent)', () => {
  it('returns { ok: false, reason: config_error } and calls no fetch when disabled (no document)', async () => {
    findUnique.mockResolvedValue(null);
    await expect(sendTestWebexMessage('ops@corp.example')).resolves.toEqual({
      ok: false,
      reason: 'config_error',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns config_error (no fetch) when enabled but no token is stored', async () => {
    findUnique.mockResolvedValue(doc({ enabled: true, botTokenEnc: null }));
    await expect(sendTestWebexMessage('ops@corp.example')).resolves.toEqual({
      ok: false,
      reason: 'config_error',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns config_error when the settings read throws (no fetch)', async () => {
    findUnique.mockRejectedValue(new Error('mongo unreachable'));
    await expect(sendTestWebexMessage('ops@corp.example')).resolves.toEqual({
      ok: false,
      reason: 'config_error',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[WEBEX] test settings read failed'),
      expect.anything()
    );
  });

  it('warns (MAIL_SETTINGS_KEY) on an undecryptable stored token and returns config_error, no fetch', async () => {
    // The undecryptable-token warning is exercised on sendWebexMessage elsewhere; this
    // covers the same warn helper on the diagnostic test path (enabled + a stored
    // ciphertext that will not decrypt -> not effectively enabled -> config_error).
    findUnique.mockResolvedValue(doc({ enabled: true, botTokenEnc: 'garbage-that-will-not-decrypt' }));
    await expect(sendTestWebexMessage('ops@corp.example')).resolves.toEqual({
      ok: false,
      reason: 'config_error',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('MAIL_SETTINGS_KEY');
  });
});

// ---------------------------------------------------------------------------
// sendTestWebexMessage() — real send path + fixed reason categories
// ---------------------------------------------------------------------------
describe('sendTestWebexMessage (real send path)', () => {
  beforeEach(() => {
    findUnique.mockResolvedValue(doc({ enabled: true, botTokenEnc: encrypt('bot-token-xyz') }));
  });

  it('returns { ok: true } on a 2xx and posts the fixed test markdown', async () => {
    fetchMock.mockResolvedValue(response({ ok: true, status: 200 }));

    await expect(sendTestWebexMessage('ops@corp.example')).resolves.toEqual({ ok: true });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.toPersonEmail).toBe('ops@corp.example');
    expect(typeof body.markdown).toBe('string');
    expect(body.markdown.length).toBeGreaterThan(0);
  });

  const statusCases: Array<[number, string, string | undefined]> = [
    [401, 'invalid_token', undefined],
    [403, 'invalid_token', undefined],
    [404, 'recipient_not_found', undefined],
    [400, 'recipient_not_found', 'Unable to find a user with email ops@corp.example'],
    [400, 'unknown', 'Some other bad-request reason'],
    [429, 'rate_limited', undefined],
    [500, 'unknown', undefined],
  ];

  for (const [status, reason, body] of statusCases) {
    it(`maps HTTP ${status} -> reason ${reason}`, async () => {
      fetchMock.mockResolvedValue(response({ ok: false, status, body }));
      await expect(sendTestWebexMessage('ops@corp.example')).resolves.toEqual({ ok: false, reason });
    });
  }

  it('maps an AbortSignal timeout (TimeoutError) -> timeout', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' }));
    await expect(sendTestWebexMessage('ops@corp.example')).resolves.toEqual({ ok: false, reason: 'timeout' });
  });

  it('maps an AbortError -> timeout', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(sendTestWebexMessage('ops@corp.example')).resolves.toEqual({ ok: false, reason: 'timeout' });
  });

  it('maps a fetch network error (TypeError) -> connection_failed', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(sendTestWebexMessage('ops@corp.example')).resolves.toEqual({
      ok: false,
      reason: 'connection_failed',
    });
  });

  // undici wraps a low-level DNS/connect/TLS failure in TypeError('fetch failed')
  // with the real code on `.cause`. That code now SELECTS the specific transport
  // reason (mirroring the mail test button) instead of collapsing to a single
  // connection_failed. SECURITY: only the fixed category is returned — the raw
  // cause code never travels back in the reason.
  const causeCodeCases: Array<[string, WebexFailureReason]> = [
    ['ENOTFOUND', 'host_not_found'],
    ['EAI_AGAIN', 'host_not_found'],
    ['EDNS', 'host_not_found'],
    ['ECONNREFUSED', 'connection_refused'],
    ['ETIMEDOUT', 'timeout'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls_error'],
  ];

  for (const [code, reason] of causeCodeCases) {
    it(`buckets the undici cause code ${code} -> reason ${reason}`, async () => {
      fetchMock.mockRejectedValue(
        Object.assign(new TypeError('fetch failed'), { cause: { code } })
      );
      const result = await sendTestWebexMessage('ops@corp.example');
      expect(result).toEqual({ ok: false, reason });
      // No-leak regression guard: the reason is ALWAYS a fixed enum member, and is
      // never the raw cause code string that only SELECTED it.
      expect(FIXED_WEBEX_REASONS).toContain((result as { reason: WebexFailureReason }).reason);
      expect(JSON.stringify(result)).not.toContain(code);
    });
  }

  it('maps a bare TypeError with no cause code -> connection_failed (generic transport fallback)', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(sendTestWebexMessage('ops@corp.example')).resolves.toEqual({
      ok: false,
      reason: 'connection_failed',
    });
  });

  it('still logs the undici cause code (cause=ENOTFOUND) while mapping it to host_not_found', async () => {
    // The [WEBEX] log line carries the real code so an admin can tell DNS from a
    // refused connect or a TLS error, even though the client only ever sees the
    // fixed host_not_found category.
    fetchMock.mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    );
    await expect(sendTestWebexMessage('ops@corp.example')).resolves.toEqual({
      ok: false,
      reason: 'host_not_found',
    });
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes('cause=ENOTFOUND'))).toBe(true);
  });

  it('maps a plain thrown Error (no name/kind) -> unknown', async () => {
    fetchMock.mockRejectedValue(new Error('mystery'));
    await expect(sendTestWebexMessage('ops@corp.example')).resolves.toEqual({ ok: false, reason: 'unknown' });
  });
});

// ---------------------------------------------------------------------------
// SECURITY: neither the bot token nor any response body may leak into the result
// the route serializes back to the client — only the fixed reason category.
// ---------------------------------------------------------------------------
describe('sendTestWebexMessage (SECURITY: no secret / body leaks into the result)', () => {
  const SENTINEL_TOKEN = 'S3NTINEL-BOT-TOKEN-do-not-leak-42';
  const SENTINEL_BODY = '401 message user=admin token=leaky-secret trackingId=abc';

  it('a 401 returns only { ok: false, reason: invalid_token } with no token or body text', async () => {
    findUnique.mockResolvedValue(doc({ enabled: true, botTokenEnc: encrypt(SENTINEL_TOKEN) }));
    fetchMock.mockResolvedValue(response({ ok: false, status: 401, body: SENTINEL_BODY }));

    const result = await sendTestWebexMessage('ops@corp.example');
    expect(result).toEqual({ ok: false, reason: 'invalid_token' });

    const serialized = JSON.stringify(result);
    expect(serialized).toContain('invalid_token');
    expect(serialized).not.toContain(SENTINEL_TOKEN);
    expect(serialized).not.toContain('leaky-secret');
    expect(serialized).not.toContain('401');
    // No log line carries the decrypted token either.
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(SENTINEL_TOKEN);
    }
  });
});

// ---------------------------------------------------------------------------
// listWebexRooms() — the admin room picker's data source.
//
// Mirrors sendTestWebexMessage's discipline: a single effective-config read, a
// never-throw contract, and on failure a FIXED WebexFailureReason (via the same
// mapping the test-send uses). SECURITY: the bot token is the Bearer credential only
// and is NEVER part of the returned value (neither the rooms nor the reason carry it).
// ---------------------------------------------------------------------------
describe('listWebexRooms', () => {
  it('returns { ok: false, config_error } and calls no fetch when disabled (no document)', async () => {
    findUnique.mockResolvedValue(null);
    await expect(listWebexRooms()).resolves.toEqual({ ok: false, reason: 'config_error' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns config_error (no fetch) when the settings read throws', async () => {
    findUnique.mockRejectedValue(new Error('mongo unreachable'));
    await expect(listWebexRooms()).resolves.toEqual({ ok: false, reason: 'config_error' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[WEBEX] rooms settings read failed'),
      expect.anything()
    );
  });

  describe('enabled', () => {
    beforeEach(() => {
      findUnique.mockResolvedValue(doc({ enabled: true, botTokenEnc: encrypt('bot-token-xyz') }));
    });

    it('GETs /v1/rooms with Bearer auth + timeout and maps items to { id, title } (other fields ignored)', async () => {
      fetchMock.mockResolvedValue(
        roomsResponse({
          ok: true,
          status: 200,
          json: {
            items: [
              { id: 'R1', title: 'Room One', type: 'group', extra: 'ignored' },
              { id: 'R2', title: 'Room Two' },
            ],
          },
        })
      );

      const result = await listWebexRooms();
      expect(result).toEqual({
        ok: true,
        rooms: [
          { id: 'R1', title: 'Room One' },
          { id: 'R2', title: 'Room Two' },
        ],
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      // The picker query pins the listing to group spaces in one large page.
      expect(url).toBe(`${DEFAULT_BASE}/v1/rooms?type=group&max=1000`);
      expect(url).toContain('type=group');
      expect(url).toContain('max=');
      expect(init.method).toBe('GET');
      expect(init.headers.Authorization).toBe('Bearer bot-token-xyz');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('honors a WEBEX_API_BASE_URL override (trailing slash trimmed)', async () => {
      process.env.WEBEX_API_BASE_URL = 'https://webex.proxy.internal/';
      fetchMock.mockResolvedValue(roomsResponse({ ok: true, status: 200, json: { items: [] } }));

      await expect(listWebexRooms()).resolves.toEqual({ ok: true, rooms: [] });
      expect(fetchMock.mock.calls[0][0]).toBe('https://webex.proxy.internal/v1/rooms?type=group&max=1000');
    });

    it('skips items with a missing / empty / non-string id (keeps only well-formed rooms)', async () => {
      fetchMock.mockResolvedValue(
        roomsResponse({
          ok: true,
          status: 200,
          json: {
            items: [
              { title: 'no id at all' },
              { id: '', title: 'empty id' },
              { id: 123, title: 'non-string id' },
              { id: 'R9', title: 'Keep me' },
            ],
          },
        })
      );
      await expect(listWebexRooms()).resolves.toEqual({ ok: true, rooms: [{ id: 'R9', title: 'Keep me' }] });
    });

    it('falls back to the id as the title when a room has no usable title', async () => {
      fetchMock.mockResolvedValue(
        roomsResponse({
          ok: true,
          status: 200,
          json: {
            items: [
              { id: 'R1' }, // title missing
              { id: 'R2', title: '' }, // title empty
              { id: 'R3', title: 42 }, // title non-string
              { id: 'R4', title: 'Has Title' },
            ],
          },
        })
      );
      await expect(listWebexRooms()).resolves.toEqual({
        ok: true,
        rooms: [
          { id: 'R1', title: 'R1' },
          { id: 'R2', title: 'R2' },
          { id: 'R3', title: 'R3' },
          { id: 'R4', title: 'Has Title' },
        ],
      });
    });

    // ------- non-OK failure mapping (rooms-specific, NOT the message-send mapper) -------
    it('maps a 401 to { ok: false, invalid_token }', async () => {
      fetchMock.mockResolvedValue(response({ ok: false, status: 401 }));
      await expect(listWebexRooms()).resolves.toEqual({ ok: false, reason: 'invalid_token' });
    });

    it('maps a 429 to { ok: false, rate_limited }', async () => {
      fetchMock.mockResolvedValue(response({ ok: false, status: 429 }));
      await expect(listWebexRooms()).resolves.toEqual({ ok: false, reason: 'rate_limited' });
    });

    it('maps a 404 to { ok: false, unknown } (a listing has NO recipient — never recipient_not_found)', async () => {
      fetchMock.mockResolvedValue(response({ ok: false, status: 404 }));
      const result = await listWebexRooms();
      expect(result).toEqual({ ok: false, reason: 'unknown' });
      // Regression guard: the rooms mapper must NOT reuse the message-send 404 bucket.
      expect(result).not.toEqual({ ok: false, reason: 'recipient_not_found' });
    });

    it('maps a 400 to { ok: false, unknown } (no body sniff for a listing)', async () => {
      fetchMock.mockResolvedValue(response({ ok: false, status: 400, body: 'person email not found' }));
      await expect(listWebexRooms()).resolves.toEqual({ ok: false, reason: 'unknown' });
    });

    it('maps a fetch network error (TypeError) to { ok: false, connection_failed }', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));
      await expect(listWebexRooms()).resolves.toEqual({ ok: false, reason: 'connection_failed' });
    });

    // ------- parse failure vs. genuine empty listing (2xx) -------
    it('maps a non-JSON 2xx body to { ok: false, unknown } (parse failure, NOT zero rooms)', async () => {
      fetchMock.mockResolvedValue(roomsResponse({ ok: true, status: 200 })); // json() rejects
      await expect(listWebexRooms()).resolves.toEqual({ ok: false, reason: 'unknown' });
    });

    it('maps a 2xx body whose items is not an array to { ok: false, unknown }', async () => {
      fetchMock.mockResolvedValue(roomsResponse({ ok: true, status: 200, json: {} }));
      await expect(listWebexRooms()).resolves.toEqual({ ok: false, reason: 'unknown' });

      fetchMock.mockResolvedValue(roomsResponse({ ok: true, status: 200, json: { items: null } }));
      await expect(listWebexRooms()).resolves.toEqual({ ok: false, reason: 'unknown' });
    });

    it('maps a genuine empty listing (items: []) to { ok: true, rooms: [] }', async () => {
      fetchMock.mockResolvedValue(roomsResponse({ ok: true, status: 200, json: { items: [] } }));
      await expect(listWebexRooms()).resolves.toEqual({ ok: true, rooms: [] });
    });

    it('never returns the bot token in the result (success OR failure)', async () => {
      const SENTINEL = 'S3NTINEL-ROOMS-TOKEN-do-not-leak';
      findUnique.mockResolvedValue(doc({ enabled: true, botTokenEnc: encrypt(SENTINEL) }));

      fetchMock.mockResolvedValue(
        roomsResponse({ ok: true, status: 200, json: { items: [{ id: 'R1', title: 'Room One' }] } })
      );
      const okResult = await listWebexRooms();
      expect(okResult).toEqual({ ok: true, rooms: [{ id: 'R1', title: 'Room One' }] });
      expect(JSON.stringify(okResult)).not.toContain(SENTINEL);

      fetchMock.mockResolvedValue(response({ ok: false, status: 401 }));
      const failResult = await listWebexRooms();
      expect(JSON.stringify(failResult)).not.toContain(SENTINEL);
      // No log line carries the decrypted token either.
      for (const call of errorSpy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(SENTINEL);
      }
    });
  });
});
