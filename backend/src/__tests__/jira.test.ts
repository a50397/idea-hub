// Unit coverage for the Jira Cloud client + its effective-config reader:
//   - config/jira.ts   getEffectiveJiraConfig()  (async, over the singleton settings)
//   - utils/jira.ts    sanitizeRemoteString / plainTextToAdf / buildJiraBrowseUrl
//   - utils/jira.ts    createJiraIssue / searchJiraIssuesByIds / getJiraIssue
//   - utils/jira.ts    testJiraConnection / listJiraProjects
//
// Prisma is mocked at the @prisma/client boundary (so lib/prisma resolves to the
// mock) to control the single JiraSettings document. The global fetch is mocked so
// no real HTTP happens. The REAL secretbox is used with a fixed test key, so the API
// token decryption is genuine.
//
// The security-relevant invariants pinned here (do not relax without re-review):
//   - every request carries HTTP Basic auth built from email+token, a ~10s
//     AbortSignal and `redirect: 'manual'` (F1),
//   - a 3xx is a FAILURE, never a followed hop (F1),
//   - a returned `reason` is ALWAYS one of the closed JiraFailureReason codes and
//     never carries upstream text, and the token appears in NO returned value (F9),
//   - remote strings are sanitized at ingest (F5) and non-numeric issue ids can
//     never reach the JQL clause.

const mockPrisma: { jiraSettings: { findUnique: jest.Mock } } = {
  jiraSettings: { findUnique: jest.fn() },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
}));

import {
  buildJiraBrowseUrl,
  createJiraIssue,
  getJiraIssue,
  isValidJiraIssueId,
  listJiraProjects,
  plainTextToAdf,
  sanitizeRemoteString,
  searchJiraIssuesByIds,
  testJiraConnection,
  type JiraFailureReason,
} from '../utils/jira';
import { getEffectiveJiraConfig, type EffectiveJiraConfig } from '../config/jira';
import { encrypt } from '../utils/secretbox';

const findUnique = mockPrisma.jiraSettings.findUnique;

// 64 hex chars == 32 bytes (the documented hex key form; same as the webex suite).
const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

// The CLOSED set of reason categories any call may return. Used as the no-leak
// regression guard: a returned reason is ALWAYS a member of this fixed enum, never a
// raw cause code / HTTP status / response-body string.
const FIXED_JIRA_REASONS: readonly JiraFailureReason[] = [
  'invalid_credentials',
  'project_not_found',
  'invalid_request',
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

/** Build a JiraSettings-shaped document with disabled defaults + overrides. */
function doc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'settings1',
    singleton: 'singleton',
    enabled: false,
    baseUrl: '',
    email: '',
    apiTokenEnc: null,
    defaultProjectKey: '',
    issueTypeName: 'Task',
    pollIntervalMinutes: 5,
    cancelResolutions: "Won't Do,Cancelled,Duplicate",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** A fully configured settings document (enabled, credentialed). */
function configuredDoc(overrides: Record<string, unknown> = {}) {
  return doc({
    enabled: true,
    baseUrl: 'https://acme.atlassian.net',
    email: 'tech@corp.example',
    apiTokenEnc: encrypt('jira-api-token'),
    defaultProjectKey: 'OPS',
    ...overrides,
  });
}

/**
 * A minimal Response-like object honoring the fields the client reads: ok, status,
 * headers.get (Content-Length / Retry-After), json() and text().
 */
function response(init: {
  status: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}): Response {
  const headers = init.headers ?? {};
  return {
    ok: init.status >= 200 && init.status < 300,
    status: init.status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: async () => {
      if (init.json === undefined) throw new Error('not json');
      return init.json;
    },
    text: async () => init.text ?? '',
  } as unknown as Response;
}

/** A full EffectiveJiraConfig a caller would hand to the client. */
function cfg(overrides: Partial<EffectiveJiraConfig> = {}): EffectiveJiraConfig {
  return {
    enabled: true,
    effectiveEnabled: true,
    baseUrl: 'https://acme.atlassian.net',
    baseUrlFromEnv: false,
    email: 'tech@corp.example',
    token: 'jira-api-token',
    defaultProjectKey: 'OPS',
    issueTypeName: 'Task',
    pollIntervalMinutes: 5,
    cancelResolutions: ["won't do", 'cancelled', 'duplicate'],
    hasToken: true,
    tokenDecryptable: true,
    ...overrides,
  };
}

/** The single fetch call's [url, init] pair. */
function fetchCall(index = 0): [string, RequestInit] {
  return fetchMock.mock.calls[index] as [string, RequestInit];
}

/** An undici-style transport error: TypeError('fetch failed') with a cause code. */
function transportError(code: string): Error {
  return Object.assign(new TypeError('fetch failed'), { cause: { code } });
}

beforeAll(() => {
  savedKey = process.env.MAIL_SETTINGS_KEY;
  savedBase = process.env.JIRA_API_BASE_URL;
  process.env.MAIL_SETTINGS_KEY = TEST_KEY;
});

afterAll(() => {
  if (savedKey === undefined) delete process.env.MAIL_SETTINGS_KEY;
  else process.env.MAIL_SETTINGS_KEY = savedKey;
  if (savedBase === undefined) delete process.env.JIRA_API_BASE_URL;
  else process.env.JIRA_API_BASE_URL = savedBase;
});

beforeEach(() => {
  findUnique.mockReset();
  delete process.env.JIRA_API_BASE_URL; // hermetic: the DB value decides unless opted in
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
// getEffectiveJiraConfig()
// ---------------------------------------------------------------------------
describe('getEffectiveJiraConfig', () => {
  it('returns disabled defaults when no settings document exists', async () => {
    findUnique.mockResolvedValue(null);
    const c = await getEffectiveJiraConfig();
    expect(c.enabled).toBe(false);
    expect(c.effectiveEnabled).toBe(false);
    expect(c.baseUrl).toBe('');
    expect(c.token).toBe('');
    expect(c.issueTypeName).toBe('Task');
    expect(c.pollIntervalMinutes).toBe(5);
    expect(c.cancelResolutions).toEqual(["won't do", 'cancelled', 'duplicate']);
    expect(c.hasToken).toBe(false);
  });

  it('is effectiveEnabled and decrypts the token when fully configured', async () => {
    findUnique.mockResolvedValue(configuredDoc());
    const c = await getEffectiveJiraConfig();
    expect(c.effectiveEnabled).toBe(true);
    expect(c.token).toBe('jira-api-token');
    expect(c.hasToken).toBe(true);
    expect(c.tokenDecryptable).toBe(true);
    expect(c.baseUrlFromEnv).toBe(false);
  });

  it.each([
    ['no base URL', { baseUrl: '' }],
    ['no account email', { email: '' }],
    ['no token', { apiTokenEnc: null }],
    ['disabled', { enabled: false }],
    ['an undecryptable token', { apiTokenEnc: 'not-valid-ciphertext' }],
  ])('is NOT effectiveEnabled with %s', async (_label, overrides) => {
    findUnique.mockResolvedValue(configuredDoc(overrides));
    expect((await getEffectiveJiraConfig()).effectiveEnabled).toBe(false);
  });

  it('strips trailing slashes from the stored base URL', async () => {
    findUnique.mockResolvedValue(configuredDoc({ baseUrl: 'https://acme.atlassian.net///' }));
    expect((await getEffectiveJiraConfig()).baseUrl).toBe('https://acme.atlassian.net');
  });

  // JIRA_API_BASE_URL is the test/proxy override (the WEBEX_API_BASE_URL precedent).
  // It wins over the stored value AND is remembered as env-sourced, which is what
  // lets the browse-URL rule accept plain http for it.
  it('lets JIRA_API_BASE_URL override the stored base URL and marks it env-sourced', async () => {
    process.env.JIRA_API_BASE_URL = 'http://localhost:8098/';
    findUnique.mockResolvedValue(configuredDoc());
    const c = await getEffectiveJiraConfig();
    expect(c.baseUrl).toBe('http://localhost:8098');
    expect(c.baseUrlFromEnv).toBe(true);
  });

  // TEST-ONLY, ENFORCED. Outside a test run the override is a credential-retarget
  // primitive (it would send the stored email+token to an arbitrary origin, past the
  // F1 save-time rules and the F2 credential binding), so it is IGNORED: the stored
  // base URL wins for the outbound calls AND for the browse URL handed to the browser.
  it('IGNORES JIRA_API_BASE_URL outside a test run (production keeps the stored base URL)', async () => {
    const savedEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      process.env.JIRA_API_BASE_URL = 'http://attacker.example';
      findUnique.mockResolvedValue(configuredDoc());

      const c = await getEffectiveJiraConfig();

      expect(c.baseUrl).toBe('https://acme.atlassian.net');
      expect(c.baseUrlFromEnv).toBe(false);

      // The outbound call goes to the STORED host...
      fetchMock.mockResolvedValue(response({ status: 201, json: { id: '10001', key: 'OPS-1' } }));
      const created = await createJiraIssue(c, {
        projectKey: 'OPS',
        summary: 'x',
        description: 'y',
      });
      expect(fetchCall()[0]).toBe('https://acme.atlassian.net/rest/api/3/issue');
      // ...and so does the browse URL (which, being DB-sourced again, is https-only).
      expect(created).toMatchObject({ ok: true, browseUrl: 'https://acme.atlassian.net/browse/OPS-1' });
      expect(buildJiraBrowseUrl(c, 'OPS-1')).toBe('https://acme.atlassian.net/browse/OPS-1');
    } finally {
      process.env.NODE_ENV = savedEnv;
    }
  });

  it('clamps the poll interval into [1, 1440] minutes', async () => {
    findUnique.mockResolvedValue(configuredDoc({ pollIntervalMinutes: 0 }));
    expect((await getEffectiveJiraConfig()).pollIntervalMinutes).toBe(1);
    findUnique.mockResolvedValue(configuredDoc({ pollIntervalMinutes: 99999 }));
    expect((await getEffectiveJiraConfig()).pollIntervalMinutes).toBe(1440);
  });

  it('parses cancelResolutions into a trimmed, lowercased, blank-free list', async () => {
    findUnique.mockResolvedValue(configuredDoc({ cancelResolutions: "  Won't Do , ,DUPLICATE ," }));
    expect((await getEffectiveJiraConfig()).cancelResolutions).toEqual(["won't do", 'duplicate']);
  });
});

// ---------------------------------------------------------------------------
// sanitizeRemoteString — the ingest boundary (F5)
// ---------------------------------------------------------------------------
describe('sanitizeRemoteString', () => {
  it('returns the value unchanged when it is already clean', () => {
    expect(sanitizeRemoteString('In Review')).toBe('In Review');
  });

  it('strips C0 control characters and DEL (log forging / CSV corruption)', () => {
    expect(sanitizeRemoteString('In\u0000Rev\u0007iew\u007f')).toBe('InReview');
  });

  it('collapses newlines into a single space so a value cannot forge a log line', () => {
    expect(sanitizeRemoteString('Done\n[JIRA] forged line')).toBe('Done [JIRA] forged line');
    expect(sanitizeRemoteString('a\r\n\r\nb')).toBe('a b');
  });

  // TAB is a SEPARATOR, not a control to delete: dropping it outright glued the two
  // words of a real Jira status together ("In\tReview" -> "InReview").
  it('turns TAB into a space instead of deleting it', () => {
    expect(sanitizeRemoteString('In\tReview')).toBe('In Review');
    expect(sanitizeRemoteString('a\t\tb')).toBe('a b');
    expect(sanitizeRemoteString('a\t\r\n b')).toBe('a b');
  });

  // Invisible formatting characters: a bidi override/isolate can make a stored
  // status or assignee RENDER in a different order than it is stored, and a
  // zero-width character hides inside a value that then looks identical to another.
  // Both are dropped, and dropped WITHOUT leaving a space (they sit mid-word).
  it.each([
    ['a bidi RLO override (U+202E)', 'Do\u202Ene', 'Done'],
    ['a bidi LRE embed (U+202A)', '\u202AIn Review', 'In Review'],
    ['a bidi PDF (U+202C)', 'Done\u202C', 'Done'],
    ['a bidi isolate (U+2066/U+2069)', '\u2066Won\u2069t Do', 'Wont Do'],
    ['a zero-width space (U+200B)', 'Do\u200Bne', 'Done'],
    ['a zero-width joiner/non-joiner (U+200C/U+200D)', 'D\u200Co\u200Dne', 'Done'],
    ['a BOM / zero-width no-break space (U+FEFF)', '\uFEFFDone\uFEFF', 'Done'],
  ])('strips %s', (_label, input, expected) => {
    expect(sanitizeRemoteString(input)).toBe(expected);
  });

  it('returns null for a value made ONLY of invisible characters', () => {
    expect(sanitizeRemoteString('\u200B\u202E\uFEFF')).toBeNull();
  });

  it('trims and caps at the requested length', () => {
    expect(sanitizeRemoteString('   padded   ')).toBe('padded');
    expect(sanitizeRemoteString('x'.repeat(300))).toHaveLength(255);
    expect(sanitizeRemoteString('abcdef', 3)).toBe('abc');
  });

  it('returns null for a non-string or an empty result (never an empty string)', () => {
    expect(sanitizeRemoteString(undefined)).toBeNull();
    expect(sanitizeRemoteString(null)).toBeNull();
    expect(sanitizeRemoteString(42)).toBeNull();
    expect(sanitizeRemoteString({})).toBeNull();
    expect(sanitizeRemoteString('   ')).toBeNull();
    expect(sanitizeRemoteString('\u0000\u0001')).toBeNull();
  });
});

describe('isValidJiraIssueId', () => {
  it('accepts only numeric strings (the JQL-injection guard)', () => {
    expect(isValidJiraIssueId('10001')).toBe(true);
    expect(isValidJiraIssueId('0')).toBe(true);
    expect(isValidJiraIssueId('10001) OR project=SECRET')).toBe(false);
    expect(isValidJiraIssueId('OPS-1')).toBe(false);
    expect(isValidJiraIssueId('')).toBe(false);
    expect(isValidJiraIssueId(10001)).toBe(false);
    expect(isValidJiraIssueId(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// plainTextToAdf — REST v3 rejects a plain-string description
// ---------------------------------------------------------------------------
describe('plainTextToAdf', () => {
  it('maps each non-empty line to its own paragraph with a single text node', () => {
    expect(plainTextToAdf('first\nsecond')).toEqual({
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'first' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'second' }] },
      ],
    });
  });

  it('drops blank lines (an empty text node is invalid ADF)', () => {
    const adf = plainTextToAdf('a\n\n   \nb');
    expect(adf.content).toHaveLength(2);
    for (const paragraph of adf.content) {
      for (const node of paragraph.content ?? []) {
        expect(node.text.length).toBeGreaterThan(0);
      }
    }
  });

  it('produces ONE EMPTY paragraph (never an empty text node) for empty input', () => {
    expect(plainTextToAdf('   \n  ')).toEqual({
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph' }],
    });
  });
});

// ---------------------------------------------------------------------------
// buildJiraBrowseUrl — the F7 protocol rule
// ---------------------------------------------------------------------------
describe('buildJiraBrowseUrl (F7 protocol rule)', () => {
  it('builds the link for an https base stored in the DATABASE', () => {
    expect(buildJiraBrowseUrl(cfg({ baseUrlFromEnv: false }), 'OPS-1')).toBe(
      'https://acme.atlassian.net/browse/OPS-1'
    );
  });

  it('REFUSES an http base that came from the database (would be a downgrade)', () => {
    expect(
      buildJiraBrowseUrl(cfg({ baseUrl: 'http://acme.atlassian.net', baseUrlFromEnv: false }), 'OPS-1')
    ).toBeNull();
  });

  it('allows an http base that came from the JIRA_API_BASE_URL override (e2e mock)', () => {
    expect(buildJiraBrowseUrl(cfg({ baseUrl: 'http://localhost:8098', baseUrlFromEnv: true }), 'OPS-1')).toBe(
      'http://localhost:8098/browse/OPS-1'
    );
  });

  it.each([
    ['a javascript: base (stored XSS vector)', 'javascript:alert(1)'],
    ['a data: base', 'data:text/html,<script>alert(1)</script>'],
    ['an unparseable base', 'not a url'],
    ['an empty base', ''],
  ])('returns null for %s even when env-sourced', (_label, baseUrl) => {
    expect(buildJiraBrowseUrl(cfg({ baseUrl, baseUrlFromEnv: true }), 'OPS-1')).toBeNull();
  });

  it.each([
    ['a missing key', null],
    ['an empty key', ''],
    ['a path traversal attempt', '../../admin'],
    ['a key with a scheme', 'https://evil.example/x'],
    ['a non-string', 42 as unknown as string],
  ])('returns null for %s', (_label, key) => {
    expect(buildJiraBrowseUrl(cfg(), key as string | null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createJiraIssue
// ---------------------------------------------------------------------------
describe('createJiraIssue', () => {
  const input = { projectKey: 'OPS', summary: 'A great idea', description: 'why\nit matters' };

  it('POSTs to /rest/api/3/issue with Basic auth, manual redirect and a timeout signal', async () => {
    fetchMock.mockResolvedValue(response({ status: 201, json: { id: '10001', key: 'OPS-1' } }));

    const result = await createJiraIssue(cfg(), input);

    expect(result).toEqual({
      ok: true,
      issueId: '10001',
      issueKey: 'OPS-1',
      browseUrl: 'https://acme.atlassian.net/browse/OPS-1',
    });

    const [url, init] = fetchCall();
    expect(url).toBe('https://acme.atlassian.net/rest/api/3/issue');
    expect(init.method).toBe('POST');
    // HTTP Basic: base64("email:token").
    const expectedAuth = `Basic ${Buffer.from('tech@corp.example:jira-api-token').toString('base64')}`;
    expect((init.headers as Record<string, string>).Authorization).toBe(expectedAuth);
    // F1: a redirect must NEVER be followed — it would replay the credential.
    expect(init.redirect).toBe('manual');
    // F4: every request is time-boxed.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends the description as ADF and the configured issue type, with NO labels', async () => {
    fetchMock.mockResolvedValue(response({ status: 201, json: { id: '10001', key: 'OPS-1' } }));

    await createJiraIssue(cfg({ issueTypeName: 'Story' }), input);

    const body = JSON.parse(String(fetchCall()[1].body));
    expect(body.fields.project).toEqual({ key: 'OPS' });
    expect(body.fields.issuetype).toEqual({ name: 'Story' });
    expect(body.fields.description).toEqual(plainTextToAdf('why\nit matters'));
    // Labels reject whitespace in Jira; tags stay in-app.
    expect(body.fields).not.toHaveProperty('labels');
  });

  it('flattens newlines in the summary and caps it at 255 characters', async () => {
    fetchMock.mockResolvedValue(response({ status: 201, json: { id: '10001', key: 'OPS-1' } }));

    await createJiraIssue(cfg(), { ...input, summary: `${'a'.repeat(300)}\nsecond line` });

    const body = JSON.parse(String(fetchCall()[1].body));
    expect(body.fields.summary).toHaveLength(255);
    expect(body.fields.summary).not.toContain('\n');
  });

  it('returns config_error WITHOUT any network call when Jira is not effectively enabled', async () => {
    const result = await createJiraIssue(cfg({ effectiveEnabled: false }), input);
    expect(result).toEqual({ ok: false, reason: 'config_error' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'invalid_credentials'],
    [403, 'invalid_credentials'],
    [404, 'project_not_found'],
    [429, 'rate_limited'],
    [500, 'unknown'],
    // F1: a 3xx reached us only because redirects are refused -> a plain failure.
    [301, 'unknown'],
    [302, 'unknown'],
  ])('maps HTTP %s to reason %s', async (status, reason) => {
    fetchMock.mockResolvedValue(response({ status }));
    const result = await createJiraIssue(cfg(), input);
    expect(result).toMatchObject({ ok: false, reason });
  });

  it('categorizes a 400 that names the project as project_not_found (body never surfaced)', async () => {
    fetchMock.mockResolvedValue(
      response({ status: 400, text: '{"errors":{"project":"project is required"}}' })
    );
    const result = await createJiraIssue(cfg(), input);
    expect(result).toEqual({ ok: false, reason: 'project_not_found' });
    expect(JSON.stringify(result)).not.toContain('project is required');
  });

  it('categorizes any other 400 as invalid_request', async () => {
    fetchMock.mockResolvedValue(response({ status: 400, text: '{"errors":{"customfield_1":"required"}}' }));
    expect(await createJiraIssue(cfg(), input)).toEqual({ ok: false, reason: 'invalid_request' });
  });

  // F4: the 400 keyword scan is the ONLY error body this client reads, so it carries
  // the same Content-Length ceiling as the 2xx paths. An oversized 400 is not read at
  // all — text() is never called — and still maps to a closed reason.
  it('refuses to read an oversized 400 body and still returns a closed reason', async () => {
    const text = jest.fn(async () => 'project'.repeat(1000));
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? String(10 * 1024 * 1024) : null) },
      json: async () => ({}),
      text,
    } as unknown as Response);

    const result = await createJiraIssue(cfg(), input);

    expect(text).not.toHaveBeenCalled();
    // The body would have said "project", but it was never read: the refinement is
    // deliberately lost rather than buffering an attacker-sized body for it.
    expect(result).toEqual({ ok: false, reason: 'invalid_request' });
    expect(FIXED_JIRA_REASONS).toContain((result as { reason: JiraFailureReason }).reason);
  });

  it.each([
    ['a timeout abort', Object.assign(new Error('aborted'), { name: 'TimeoutError' }), 'timeout'],
    ['a DNS failure', transportError('ENOTFOUND'), 'host_not_found'],
    ['a refused connection', transportError('ECONNREFUSED'), 'connection_refused'],
    ['an expired certificate', transportError('CERT_HAS_EXPIRED'), 'tls_error'],
    ['a TLS protocol error', transportError('ERR_TLS_CERT_ALTNAME_INVALID'), 'tls_error'],
    ['a generic fetch failure', new TypeError('fetch failed'), 'connection_failed'],
    ['an unexpected error', new Error('boom'), 'unknown'],
  ])('maps %s to reason %s', async (_label, error, reason) => {
    fetchMock.mockRejectedValue(error);
    expect(await createJiraIssue(cfg(), input)).toEqual({ ok: false, reason });
  });

  it('rejects a 2xx body whose id is missing or non-numeric (nothing unusable is stored)', async () => {
    fetchMock.mockResolvedValue(response({ status: 201, json: { key: 'OPS-1' } }));
    expect(await createJiraIssue(cfg(), input)).toEqual({ ok: false, reason: 'unknown' });

    fetchMock.mockResolvedValue(response({ status: 201, json: { id: 'OPS-1', key: 'OPS-1' } }));
    expect(await createJiraIssue(cfg(), input)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('rejects a 2xx body that is not JSON', async () => {
    fetchMock.mockResolvedValue(response({ status: 201 }));
    expect(await createJiraIssue(cfg(), input)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('refuses to read an oversized response body (Content-Length guard)', async () => {
    fetchMock.mockResolvedValue(
      response({
        status: 201,
        json: { id: '10001', key: 'OPS-1' },
        headers: { 'content-length': String(10 * 1024 * 1024) },
      })
    );
    expect(await createJiraIssue(cfg(), input)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('never logs or returns the API token', async () => {
    fetchMock.mockResolvedValue(response({ status: 401 }));
    const result = await createJiraIssue(cfg(), input);
    expect(JSON.stringify(result)).not.toContain('jira-api-token');
    const logged = [...errorSpy.mock.calls, ...logSpy.mock.calls, ...warnSpy.mock.calls]
      .map((call) => JSON.stringify(call))
      .join(' ');
    expect(logged).not.toContain('jira-api-token');
  });

  it('always returns a reason from the closed enum', async () => {
    for (const status of [400, 401, 403, 404, 409, 418, 429, 500, 503, 302]) {
      fetchMock.mockResolvedValue(response({ status, text: 'upstream detail' }));
      const result = await createJiraIssue(cfg(), input);
      expect(result.ok).toBe(false);
      expect(FIXED_JIRA_REASONS).toContain((result as { reason: JiraFailureReason }).reason);
    }
  });
});

// ---------------------------------------------------------------------------
// searchJiraIssuesByIds
// ---------------------------------------------------------------------------
describe('searchJiraIssuesByIds', () => {
  function issue(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      key: `OPS-${id.slice(-1)}`,
      fields: {
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        assignee: { displayName: 'Remote Person' },
        resolution: null,
        ...overrides,
      },
    };
  }

  it('POSTs the bounded JQL with explicit fields and maps the snapshot', async () => {
    fetchMock.mockResolvedValue(response({ status: 200, json: { issues: [issue('10001')] } }));

    const result = await searchJiraIssuesByIds(cfg(), ['10001']);

    expect(result.ok).toBe(true);
    const snapshot = (result as { issues: Map<string, unknown> }).issues.get('10001');
    expect(snapshot).toEqual({
      key: 'OPS-1',
      statusName: 'In Progress',
      categoryKey: 'indeterminate',
      assignee: 'Remote Person',
      resolution: null,
    });

    const [url, init] = fetchCall();
    expect(url).toBe('https://acme.atlassian.net/rest/api/3/search/jql');
    const body = JSON.parse(String(init.body));
    expect(body.jql).toBe('id in (10001)');
    // MANDATORY: the default projection is `id` only.
    expect(body.fields).toEqual(['status', 'assignee', 'resolution']);
    expect(body.maxResults).toBe(50);
    expect(init.redirect).toBe('manual');
  });

  it('DROPS non-numeric ids so nothing can be injected into the JQL clause', async () => {
    fetchMock.mockResolvedValue(response({ status: 200, json: { issues: [] } }));

    await searchJiraIssuesByIds(cfg(), ['10001', '10001) OR project = SECRET --', 'OPS-2', '']);

    const body = JSON.parse(String(fetchCall()[1].body));
    expect(body.jql).toBe('id in (10001)');
    expect(body.jql).not.toContain('SECRET');
  });

  it('makes NO call and returns an empty map when no id is valid', async () => {
    const result = await searchJiraIssuesByIds(cfg(), ['nope']);
    expect(result).toEqual({ ok: true, issues: new Map() });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('chunks more than 50 ids into separate bounded requests', async () => {
    fetchMock.mockResolvedValue(response({ status: 200, json: { issues: [] } }));
    const ids = Array.from({ length: 120 }, (_, i) => String(20000 + i));

    await searchJiraIssuesByIds(cfg(), ids);

    expect(fetchMock).toHaveBeenCalledTimes(3); // 50 + 50 + 20
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse(String((call[1] as RequestInit).body));
      expect(body.jql.split(',').length).toBeLessThanOrEqual(50);
    }
  });

  it('follows nextPageToken until it is absent', async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({ status: 200, json: { issues: [issue('10001')], nextPageToken: 'page-2' } })
      )
      .mockResolvedValueOnce(response({ status: 200, json: { issues: [issue('10002')] } }));

    const result = await searchJiraIssuesByIds(cfg(), ['10001', '10002']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchCall(1)[1].body)).nextPageToken).toBe('page-2');
    expect((result as { issues: Map<string, unknown> }).issues.size).toBe(2);
  });

  it('ignores an issue the batch did not ask for (no injected snapshot)', async () => {
    fetchMock.mockResolvedValue(
      response({ status: 200, json: { issues: [issue('10001'), issue('99999')] } })
    );

    const result = await searchJiraIssuesByIds(cfg(), ['10001']);

    const issues = (result as { issues: Map<string, unknown> }).issues;
    expect(issues.has('10001')).toBe(true);
    expect(issues.has('99999')).toBe(false);
  });

  it('sanitizes every remote string and normalizes an unknown status category to null', async () => {
    fetchMock.mockResolvedValue(
      response({
        status: 200,
        json: {
          issues: [
            {
              id: '10001',
              key: 'OPS-1\n[JIRA] forged',
              fields: {
                status: { name: 'Do\u0000ne', statusCategory: { key: 'MADE_UP' } },
                assignee: { displayName: 'x'.repeat(400) },
                resolution: { name: '  Fixed  ' },
              },
            },
          ],
        },
      })
    );

    const result = await searchJiraIssuesByIds(cfg(), ['10001']);
    const snapshot = (result as { issues: Map<string, any> }).issues.get('10001');

    expect(snapshot.key).toBe('OPS-1 [JIRA] forged'); // newline collapsed, not a new line
    expect(snapshot.statusName).toBe('Done'); // control char stripped
    expect(snapshot.categoryKey).toBeNull(); // unknown category is not carried
    expect(snapshot.assignee).toHaveLength(255); // capped
    expect(snapshot.resolution).toBe('Fixed'); // trimmed
  });

  it('tolerates missing/malformed fields without throwing (defensive parsing)', async () => {
    fetchMock.mockResolvedValue(
      response({ status: 200, json: { issues: [{ id: '10001' }, { id: '10002', fields: 'nope' }] } })
    );

    const result = await searchJiraIssuesByIds(cfg(), ['10001', '10002']);

    expect(result.ok).toBe(true);
    expect((result as { issues: Map<string, any> }).issues.get('10001')).toEqual({
      key: null,
      statusName: null,
      categoryKey: null,
      assignee: null,
      resolution: null,
    });
  });

  it('fails the WHOLE call when a chunk fails (a partial result would look like deletions)', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ status: 200, json: { issues: [] } }))
      .mockResolvedValueOnce(response({ status: 500 }));
    const ids = Array.from({ length: 60 }, (_, i) => String(20000 + i));

    const result = await searchJiraIssuesByIds(cfg(), ids);

    expect(result.ok).toBe(false);
  });

  it('carries the clamped Retry-After from a 429 so the poller can back off', async () => {
    fetchMock.mockResolvedValue(response({ status: 429, headers: { 'retry-after': '90' } }));
    expect(await searchJiraIssuesByIds(cfg(), ['10001'])).toEqual({
      ok: false,
      reason: 'rate_limited',
      retryAfterSeconds: 90,
    });
  });

  it('clamps a hostile Retry-After and falls back to a default when it is unusable', async () => {
    fetchMock.mockResolvedValue(response({ status: 429, headers: { 'retry-after': '999999' } }));
    expect(await searchJiraIssuesByIds(cfg(), ['10001'])).toMatchObject({ retryAfterSeconds: 3600 });

    fetchMock.mockResolvedValue(response({ status: 429, headers: { 'retry-after': 'Tue, 3 Jun 2036' } }));
    expect(await searchJiraIssuesByIds(cfg(), ['10001'])).toMatchObject({ retryAfterSeconds: 60 });
  });

  it('suggests a backoff for a 5xx too (no Retry-After required)', async () => {
    fetchMock.mockResolvedValue(response({ status: 503 }));
    expect(await searchJiraIssuesByIds(cfg(), ['10001'])).toEqual({
      ok: false,
      reason: 'unknown',
      retryAfterSeconds: 60,
    });
  });

  it('treats an unparseable body as a failure, not an empty result', async () => {
    fetchMock.mockResolvedValue(response({ status: 200, json: { nope: true } }));
    expect(await searchJiraIssuesByIds(cfg(), ['10001'])).toEqual({ ok: false, reason: 'unknown' });
  });

  it('returns config_error without any call when not effectively enabled', async () => {
    expect(await searchJiraIssuesByIds(cfg({ effectiveEnabled: false }), ['10001'])).toEqual({
      ok: false,
      reason: 'config_error',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getJiraIssue — the deletion-confirm primitive
// ---------------------------------------------------------------------------
describe('getJiraIssue', () => {
  it('reads one issue by id with the mirrored fields', async () => {
    fetchMock.mockResolvedValue(
      response({
        status: 200,
        json: {
          id: '10001',
          key: 'OPS-1',
          fields: {
            status: { name: 'Done', statusCategory: { key: 'done' } },
            assignee: null,
            resolution: { name: "Won't Do" },
          },
        },
      })
    );

    const result = await getJiraIssue(cfg(), '10001');

    expect(result).toEqual({
      ok: true,
      found: true,
      issue: {
        key: 'OPS-1',
        statusName: 'Done',
        categoryKey: 'done',
        assignee: null,
        resolution: "Won't Do",
      },
    });
    expect(fetchCall()[0]).toBe(
      'https://acme.atlassian.net/rest/api/3/issue/10001?fields=status,assignee,resolution'
    );
    expect(fetchCall()[1].method).toBe('GET');
  });

  it('reports found:false ONLY for a 404', async () => {
    fetchMock.mockResolvedValue(response({ status: 404 }));
    expect(await getJiraIssue(cfg(), '10001')).toEqual({ ok: true, found: false });
  });

  it.each([401, 403, 500, 302])(
    'treats HTTP %s as a FAILURE (never as deletion — a permission loss must not cancel ideas)',
    async (status) => {
      fetchMock.mockResolvedValue(response({ status }));
      const result = await getJiraIssue(cfg(), '10001');
      expect(result.ok).toBe(false);
    }
  );

  it('refuses a non-numeric id without building a URL out of it', async () => {
    expect(await getJiraIssue(cfg(), '../../admin')).toEqual({ ok: false, reason: 'invalid_request' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns config_error without any call when not effectively enabled', async () => {
    expect(await getJiraIssue(cfg({ effectiveEnabled: false }), '10001')).toEqual({
      ok: false,
      reason: 'config_error',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// testJiraConnection / listJiraProjects — the admin diagnostics
// ---------------------------------------------------------------------------
describe('testJiraConnection', () => {
  it('probes /rest/api/3/myself with the SAVED settings', async () => {
    findUnique.mockResolvedValue(configuredDoc());
    fetchMock.mockResolvedValue(response({ status: 200, json: { accountId: 'abc' } }));

    expect(await testJiraConnection()).toEqual({ ok: true });
    expect(fetchCall()[0]).toBe('https://acme.atlassian.net/rest/api/3/myself');
  });

  it.each([
    [401, 'invalid_credentials'],
    [403, 'invalid_credentials'],
    [429, 'rate_limited'],
    [500, 'unknown'],
    [302, 'unknown'],
  ])('maps HTTP %s to reason %s', async (status, reason) => {
    findUnique.mockResolvedValue(configuredDoc());
    fetchMock.mockResolvedValue(response({ status }));
    expect(await testJiraConnection()).toEqual({ ok: false, reason });
  });

  it('returns config_error without a call when Jira is not configured', async () => {
    findUnique.mockResolvedValue(doc());
    expect(await testJiraConnection()).toEqual({ ok: false, reason: 'config_error' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns config_error when the settings read itself fails', async () => {
    findUnique.mockRejectedValue(new Error('db down'));
    expect(await testJiraConnection()).toEqual({ ok: false, reason: 'config_error' });
  });

  it('warns (without the token) when a stored token cannot be decrypted', async () => {
    findUnique.mockResolvedValue(configuredDoc({ apiTokenEnc: 'not-valid-ciphertext' }));
    expect(await testJiraConnection()).toEqual({ ok: false, reason: 'config_error' });
    expect(warnSpy).toHaveBeenCalled();
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('jira-api-token');
  });
});

describe('listJiraProjects', () => {
  it('maps values to {key,name} and stops when isLast is true', async () => {
    findUnique.mockResolvedValue(configuredDoc());
    fetchMock.mockResolvedValue(
      response({
        status: 200,
        json: { isLast: true, values: [{ key: 'OPS', name: 'Operations' }, { key: 'DEV' }] },
      })
    );

    const result = await listJiraProjects();

    expect(result).toEqual({ ok: true, projects: [{ key: 'OPS', name: 'Operations' }, { key: 'DEV', name: 'DEV' }] });
    expect(fetchCall()[0]).toBe('https://acme.atlassian.net/rest/api/3/project/search?startAt=0&maxResults=50');
  });

  it('pages while isLast is false', async () => {
    findUnique.mockResolvedValue(configuredDoc());
    fetchMock
      .mockResolvedValueOnce(response({ status: 200, json: { isLast: false, values: [{ key: 'A', name: 'A' }] } }))
      .mockResolvedValueOnce(response({ status: 200, json: { isLast: true, values: [{ key: 'B', name: 'B' }] } }));

    const result = await listJiraProjects();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchCall(1)[0]).toContain('startAt=50');
    expect((result as { projects: unknown[] }).projects).toHaveLength(2);
  });

  it('skips a project without a usable key and sanitizes the name', async () => {
    findUnique.mockResolvedValue(configuredDoc());
    fetchMock.mockResolvedValue(
      response({
        status: 200,
        json: { isLast: true, values: [{ name: 'no key' }, { key: 'OPS', name: 'Ops\nteam' }] },
      })
    );

    expect(await listJiraProjects()).toEqual({ ok: true, projects: [{ key: 'OPS', name: 'Ops team' }] });
  });

  it('distinguishes an unparseable body from a genuine empty listing', async () => {
    findUnique.mockResolvedValue(configuredDoc());
    fetchMock.mockResolvedValue(response({ status: 200, json: { isLast: true, values: [] } }));
    expect(await listJiraProjects()).toEqual({ ok: true, projects: [] });

    fetchMock.mockResolvedValue(response({ status: 200, json: { isLast: true } }));
    expect(await listJiraProjects()).toEqual({ ok: false, reason: 'unknown' });
  });

  it.each([
    [401, 'invalid_credentials'],
    [429, 'rate_limited'],
    [500, 'unknown'],
  ])('maps HTTP %s to reason %s', async (status, reason) => {
    findUnique.mockResolvedValue(configuredDoc());
    fetchMock.mockResolvedValue(response({ status }));
    expect(await listJiraProjects()).toEqual({ ok: false, reason });
  });

  it('returns config_error without a call when Jira is not configured', async () => {
    findUnique.mockResolvedValue(doc());
    expect(await listJiraProjects()).toEqual({ ok: false, reason: 'config_error' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
