// Admin-only Jira settings API (routes/jira-settings.ts) — the webex-settings suite
// cloned for the third channel, plus the one rule that has no Webex counterpart: the
// CREDENTIAL BINDING check (security review F2).
//
// Prisma is mocked at the @prisma/client boundary; the two network-touching helpers
// (testJiraConnection, listJiraProjects) are mocked so /test and /projects return
// their structured results without real HTTP. secretbox is REAL, so the "set token"
// path proves genuine encryption (and the test can decrypt the stored ciphertext
// back).

import request from 'supertest';
import express from 'express';
import session from 'express-session';
import cors from 'cors';

// Define mock Prisma BEFORE importing routes.
const mockPrismaFunctions: Record<string, any> = {
  user: {
    findUnique: jest.fn(),
  },
  jiraSettings: {
    findUnique: jest.fn(),
    // The PUT write path is a single atomic upsert on the unique singleton key.
    upsert: jest.fn(),
  },
};

jest.mock('@prisma/client', () => {
  return {
    PrismaClient: jest.fn().mockImplementation(() => mockPrismaFunctions),
    Role: {
      USER: 'USER',
      POWER_USER: 'POWER_USER',
      ADMIN: 'ADMIN',
    },
  };
});

jest.mock('bcrypt');

// Partial mock of utils/jira: the pure helpers stay REAL, only the two
// network-touching diagnostics are stubbed.
jest.mock('../utils/jira', () => {
  const actual = jest.requireActual('../utils/jira');
  return { ...actual, testJiraConnection: jest.fn(), listJiraProjects: jest.fn() };
});

// Import routes AFTER mocks.
import bcrypt from 'bcrypt';
import authRoutes from '../routes/auth';
import jiraSettingsRoutes from '../routes/jira-settings';
import { testJiraConnection, listJiraProjects } from '../utils/jira';
import { decrypt } from '../utils/secretbox';

const mockedTestJira = jest.mocked(testJiraConnection);
const mockedListProjects = jest.mocked(listJiraProjects);

// 64 hex chars == 32 bytes.
const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
let savedKey: string | undefined;

function createTestApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    })
  );
  app.use('/api/auth', authRoutes);
  app.use('/api/jira-settings', jiraSettingsRoutes);
  return app;
}

async function loginAsUser(app: express.Application, role: string = 'ADMIN') {
  const agent = request.agent(app);
  const user = {
    id: 'user123',
    name: 'Test Admin',
    email: 'admin@example.com',
    passwordHash: 'hash',
    role,
  };
  mockPrismaFunctions.user.findUnique.mockResolvedValue(user);
  (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  await agent.post('/api/auth/login').send({ email: 'admin@example.com', password: 'password123' });
  return { agent, user };
}

// A body satisfying updateJiraSettingsSchema (apiToken is the only optional field).
function validBody(overrides: Record<string, unknown> = {}) {
  return {
    enabled: false,
    baseUrl: 'https://acme.atlassian.net',
    email: 'tech@corp.example',
    defaultProjectKey: 'OPS',
    issueTypeName: 'Task',
    pollIntervalMinutes: 5,
    cancelResolutions: "Won't Do,Cancelled,Duplicate",
    ...overrides,
  };
}

// Build a stored document. The three lastSync* fields are the poller-written health
// record; they default to "nothing recorded yet" (a freshly configured install).
function settingsDoc(overrides: Record<string, unknown> = {}) {
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
    lastSyncOk: null,
    lastSyncReason: null,
    lastSyncAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// A Prisma-style known-request error carries a `.code`; the PUT write path branches
// on it (P2002 == unique-constraint violation) via the repo's duck-typed check.
function prismaError(code: string) {
  return Object.assign(new Error(`Prisma error ${code}`), { code });
}

beforeAll(() => {
  savedKey = process.env.MAIL_SETTINGS_KEY;
  process.env.MAIL_SETTINGS_KEY = TEST_KEY;
});

afterAll(() => {
  if (savedKey === undefined) delete process.env.MAIL_SETTINGS_KEY;
  else process.env.MAIL_SETTINGS_KEY = savedKey;
});

describe('Jira settings API', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
    // Default: echo the upserted UPDATE payload back so the masked response reflects
    // persistence. Tests that assert the write shape inspect the upsert call directly.
    mockPrismaFunctions.jiraSettings.upsert.mockImplementation(
      ({ update }: { update: Record<string, unknown> }) =>
        Promise.resolve({ ...settingsDoc(), ...update })
    );
    mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(null);
  });

  // -------------------------------------------------------------------------
  // Authz: 401 unauthenticated, 403 for non-admins, on every endpoint.
  // -------------------------------------------------------------------------
  describe('authorization', () => {
    const endpoints: Array<[string, string, Record<string, unknown> | undefined]> = [
      ['get', '/api/jira-settings', undefined],
      ['put', '/api/jira-settings', validBody()],
      ['post', '/api/jira-settings/test', {}],
      ['get', '/api/jira-settings/projects', undefined],
    ];

    for (const [method, path, body] of endpoints) {
      test(`returns 401 when unauthenticated on ${method.toUpperCase()} ${path}`, async () => {
        let req = (request(app) as any)[method](path);
        if (body) req = req.send(body);
        const response = await req;
        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty('error');
      });

      test.each(['USER', 'POWER_USER'])(
        `returns 403 for a %s on ${method.toUpperCase()} ${path}`,
        async (role) => {
          const { agent } = await loginAsUser(app, role);
          let req = (agent as any)[method](path);
          if (body) req = req.send(body);
          const response = await req;
          expect(response.status).toBe(403);
          expect(mockPrismaFunctions.jiraSettings.upsert).not.toHaveBeenCalled();
        }
      );
    }
  });

  // -------------------------------------------------------------------------
  // GET — masked read
  // -------------------------------------------------------------------------
  describe('GET /api/jira-settings', () => {
    test('returns the in-code defaults when no document exists', async () => {
      const { agent } = await loginAsUser(app);

      const response = await agent.get('/api/jira-settings');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        enabled: false,
        baseUrl: '',
        email: '',
        defaultProjectKey: '',
        issueTypeName: 'Task',
        pollIntervalMinutes: 5,
        cancelResolutions: "Won't Do,Cancelled,Duplicate",
        hasToken: false,
        // No document == the poller has never recorded an outcome.
        lastSync: null,
      });
    });

    test('masks the stored token: hasToken only, never the ciphertext', async () => {
      const { agent } = await loginAsUser(app);
      mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(
        settingsDoc({
          enabled: true,
          baseUrl: 'https://acme.atlassian.net',
          email: 'tech@corp.example',
          apiTokenEnc: 'ciphertext-value-here',
        })
      );

      const response = await agent.get('/api/jira-settings');

      expect(response.status).toBe(200);
      expect(response.body.hasToken).toBe(true);
      expect(response.body).not.toHaveProperty('apiTokenEnc');
      expect(response.body).not.toHaveProperty('apiToken');
      expect(JSON.stringify(response.body)).not.toContain('ciphertext-value-here');
    });

    // The masked-response contract with the health block present: adding lastSync
    // must not open a second channel for configuration or secret material.
    test('the response is EXACTLY the masked fields + lastSync — no secret material anywhere', async () => {
      const { agent } = await loginAsUser(app);
      const failingSince = new Date('2026-08-10T07:30:00.000Z');
      mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(
        settingsDoc({
          enabled: true,
          baseUrl: 'https://acme.atlassian.net',
          email: 'tech@corp.example',
          apiTokenEnc: 'ciphertext-value-here',
          lastSyncOk: false,
          lastSyncReason: 'invalid_credentials',
          lastSyncAt: failingSince,
        })
      );

      const response = await agent.get('/api/jira-settings');

      expect(response.status).toBe(200);
      expect(Object.keys(response.body).sort()).toEqual([
        'baseUrl',
        'cancelResolutions',
        'defaultProjectKey',
        'email',
        'enabled',
        'hasToken',
        'issueTypeName',
        'lastSync',
        'pollIntervalMinutes',
      ]);
      expect(response.body.lastSync).toEqual({
        ok: false,
        reason: 'invalid_credentials',
        at: failingSince.toISOString(),
      });
      // Still no ciphertext, no plaintext token, no internal document fields.
      expect(response.body).not.toHaveProperty('apiTokenEnc');
      expect(response.body).not.toHaveProperty('apiToken');
      expect(response.body).not.toHaveProperty('id');
      expect(response.body).not.toHaveProperty('singleton');
      expect(JSON.stringify(response.body)).not.toContain('ciphertext-value-here');
    });

    test('a healthy record omits the reason and reports WHEN that state was entered', async () => {
      const { agent } = await loginAsUser(app);
      const healthySince = new Date('2026-08-11T09:00:00.000Z');
      mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(
        settingsDoc({ enabled: true, lastSyncOk: true, lastSyncReason: null, lastSyncAt: healthySince })
      );

      const response = await agent.get('/api/jira-settings');

      expect(response.body.lastSync).toEqual({ ok: true, at: healthySince.toISOString() });
      expect(response.body.lastSync).not.toHaveProperty('reason');
    });

    // The reason is one of the CLOSED JiraFailureReason codes — never upstream text
    // (F9) — so the FE can resolve it through the same fixed i18n catalog as the
    // connection test.
    test.each(['config_error', 'rate_limited', 'timeout', 'unknown'])(
      'passes the fixed failure code %s through unchanged',
      async (reason) => {
        const { agent } = await loginAsUser(app);
        mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(
          settingsDoc({ enabled: true, lastSyncOk: false, lastSyncReason: reason, lastSyncAt: new Date() })
        );

        const response = await agent.get('/api/jira-settings');

        expect(response.body.lastSync).toMatchObject({ ok: false, reason });
      }
    );

    test('a half-written health record (status without a timestamp) reads as "nothing recorded"', async () => {
      const { agent } = await loginAsUser(app);
      mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(
        settingsDoc({ lastSyncOk: false, lastSyncReason: 'timeout', lastSyncAt: null })
      );

      const response = await agent.get('/api/jira-settings');

      expect(response.body.lastSync).toBeNull();
    });

    test('returns 500 when the read fails', async () => {
      const { agent } = await loginAsUser(app);
      mockPrismaFunctions.jiraSettings.findUnique.mockRejectedValue(new Error('db down'));

      const response = await agent.get('/api/jira-settings');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });
  });

  // -------------------------------------------------------------------------
  // PUT — keep / set / wipe
  // -------------------------------------------------------------------------
  describe('PUT /api/jira-settings — token keep/set/wipe', () => {
    test('SET: a non-empty token is trimmed, encrypted and stored (never echoed)', async () => {
      const { agent } = await loginAsUser(app);

      const response = await agent
        .put('/api/jira-settings')
        .send(validBody({ enabled: true, apiToken: '  super-secret-token  ' }));

      expect(response.status).toBe(200);
      expect(response.body.hasToken).toBe(true);
      expect(JSON.stringify(response.body)).not.toContain('super-secret-token');

      const { create, update } = mockPrismaFunctions.jiraSettings.upsert.mock.calls[0][0];
      // Genuine AES-256-GCM ciphertext, reversible with the configured key.
      expect(create.apiTokenEnc).not.toBe('super-secret-token');
      expect(decrypt(create.apiTokenEnc)).toBe('super-secret-token');
      expect(decrypt(update.apiTokenEnc)).toBe('super-secret-token');
    });

    test('KEEP: an absent apiToken leaves the stored ciphertext untouched (no lost update)', async () => {
      const { agent } = await loginAsUser(app);
      mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(
        settingsDoc({
          baseUrl: 'https://acme.atlassian.net',
          email: 'tech@corp.example',
          apiTokenEnc: 'existing-ciphertext',
        })
      );

      const response = await agent.put('/api/jira-settings').send(validBody({ enabled: true }));

      expect(response.status).toBe(200);
      const { update } = mockPrismaFunctions.jiraSettings.upsert.mock.calls[0][0];
      // The UPDATE payload OMITS the token entirely, so a concurrent change survives.
      expect(update).not.toHaveProperty('apiTokenEnc');
    });

    test('WIPE: an empty-string apiToken clears the stored token', async () => {
      const { agent } = await loginAsUser(app);
      mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(
        settingsDoc({
          baseUrl: 'https://acme.atlassian.net',
          email: 'tech@corp.example',
          apiTokenEnc: 'existing-ciphertext',
        })
      );

      const response = await agent.put('/api/jira-settings').send(validBody({ apiToken: '' }));

      expect(response.status).toBe(200);
      expect(response.body.hasToken).toBe(false);
      const { update } = mockPrismaFunctions.jiraSettings.upsert.mock.calls[0][0];
      expect(update.apiTokenEnc).toBe('');
    });

    test('rejects a whitespace-only token (an "enabled" channel with an unusable credential)', async () => {
      const { agent } = await loginAsUser(app);

      const response = await agent.put('/api/jira-settings').send(validBody({ apiToken: '   ' }));

      expect(response.status).toBe(400);
      expect(mockPrismaFunctions.jiraSettings.upsert).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // F2: CREDENTIAL BINDING — changing the identity fields must not silently
  // re-target a stored credential.
  // -------------------------------------------------------------------------
  describe('PUT /api/jira-settings — credential binding (F2)', () => {
    const storedDoc = settingsDoc({
      enabled: true,
      baseUrl: 'https://acme.atlassian.net',
      email: 'tech@corp.example',
      apiTokenEnc: 'existing-ciphertext',
    });

    test('REJECTS a base-URL change that keeps the stored token (400, no write)', async () => {
      const { agent } = await loginAsUser(app);
      mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(storedDoc);

      const response = await agent
        .put('/api/jira-settings')
        .send(validBody({ enabled: true, baseUrl: 'https://evil.attacker.example' }));

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/re-entering the API token/i);
      expect(mockPrismaFunctions.jiraSettings.upsert).not.toHaveBeenCalled();
    });

    test('REJECTS an account-email change that keeps the stored token (400, no write)', async () => {
      const { agent } = await loginAsUser(app);
      mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(storedDoc);

      const response = await agent
        .put('/api/jira-settings')
        .send(validBody({ enabled: true, email: 'someone-else@corp.example' }));

      expect(response.status).toBe(400);
      expect(mockPrismaFunctions.jiraSettings.upsert).not.toHaveBeenCalled();
    });

    test('ALLOWS a base-URL change that SETS a new token', async () => {
      const { agent } = await loginAsUser(app);
      mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(storedDoc);

      const response = await agent
        .put('/api/jira-settings')
        .send(validBody({ enabled: true, baseUrl: 'https://other.atlassian.net', apiToken: 'fresh-token' }));

      expect(response.status).toBe(200);
      const { update } = mockPrismaFunctions.jiraSettings.upsert.mock.calls[0][0];
      expect(decrypt(update.apiTokenEnc)).toBe('fresh-token');
    });

    test('ALLOWS a base-URL change that WIPES the token (nothing left to leak)', async () => {
      const { agent } = await loginAsUser(app);
      mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(storedDoc);

      const response = await agent
        .put('/api/jira-settings')
        .send(validBody({ baseUrl: 'https://other.atlassian.net', apiToken: '' }));

      expect(response.status).toBe(200);
      expect(response.body.hasToken).toBe(false);
    });

    test('ALLOWS keeping the token when neither the base URL nor the email changes', async () => {
      const { agent } = await loginAsUser(app);
      mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(storedDoc);

      const response = await agent
        .put('/api/jira-settings')
        .send(validBody({ enabled: true, defaultProjectKey: 'DEV', pollIntervalMinutes: 15 }));

      expect(response.status).toBe(200);
      expect(mockPrismaFunctions.jiraSettings.upsert).toHaveBeenCalled();
    });

    // Scoped rule: with NO stored token there is no credential to re-target, so the
    // ordinary first-configuration save (URL + email now, token in a later save) is
    // allowed. This is the one place the implementation is narrower than a literal
    // reading of F2, and it is narrower ONLY where the finding cannot apply.
    test('ALLOWS an identity change when NO token is stored (nothing to re-target)', async () => {
      const { agent } = await loginAsUser(app);
      mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(
        settingsDoc({ baseUrl: '', email: '', apiTokenEnc: null })
      );

      const response = await agent.put('/api/jira-settings').send(validBody());

      expect(response.status).toBe(200);
      expect(mockPrismaFunctions.jiraSettings.upsert).toHaveBeenCalled();
    });

    test('the base URL is compared in its NORMALIZED form (a trailing slash is not a change)', async () => {
      const { agent } = await loginAsUser(app);
      mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(storedDoc);

      const response = await agent
        .put('/api/jira-settings')
        .send(validBody({ enabled: true, baseUrl: 'https://acme.atlassian.net/' }));

      expect(response.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // PUT — validation of the credential TARGET (F1). The schema does the work;
  // these cases pin that the route surfaces them as 400s and never writes.
  // -------------------------------------------------------------------------
  describe('PUT /api/jira-settings — base URL validation (F1)', () => {
    test.each([
      ['http (not https)', 'http://acme.atlassian.net'],
      ['embedded credentials', 'https://user:pass@acme.atlassian.net'],
      ['a query string', 'https://acme.atlassian.net?x=1'],
      ['a fragment', 'https://acme.atlassian.net#x'],
      ['an IPv4 literal', 'https://10.1.2.3'],
      ['an IPv6 literal', 'https://[::1]'],
      ['localhost', 'https://localhost:8098'],
      ['a .localhost host', 'https://jira.localhost'],
      ['a root-label (trailing-dot) localhost', 'https://localhost.'],
      ['a javascript: URL', 'javascript:alert(1)'],
      ['a relative value', '/rest/api/3'],
    ])('rejects %s with 400 and never writes', async (_label, baseUrl) => {
      const { agent } = await loginAsUser(app);

      const response = await agent.put('/api/jira-settings').send(validBody({ baseUrl }));

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(mockPrismaFunctions.jiraSettings.upsert).not.toHaveBeenCalled();
    });

    test('accepts an empty base URL (not configured) and stores it as-is', async () => {
      const { agent } = await loginAsUser(app);

      const response = await agent.put('/api/jira-settings').send(validBody({ baseUrl: '' }));

      expect(response.status).toBe(200);
      expect(mockPrismaFunctions.jiraSettings.upsert.mock.calls[0][0].create.baseUrl).toBe('');
    });

    test('NORMALIZES an accepted base URL to its bare origin', async () => {
      const { agent } = await loginAsUser(app);

      const response = await agent
        .put('/api/jira-settings')
        .send(validBody({ baseUrl: 'https://acme.atlassian.net/jira/' }));

      expect(response.status).toBe(200);
      expect(mockPrismaFunctions.jiraSettings.upsert.mock.calls[0][0].create.baseUrl).toBe(
        'https://acme.atlassian.net'
      );
    });
  });

  describe('PUT /api/jira-settings — other field validation', () => {
    test.each([
      ['a bad project key', { defaultProjectKey: '1OPS' }],
      ['an over-long project key', { defaultProjectKey: 'A'.repeat(33) }],
      ['an empty issue type', { issueTypeName: '' }],
      ['a zero poll interval', { pollIntervalMinutes: 0 }],
      ['an over-long poll interval', { pollIntervalMinutes: 1441 }],
      ['a fractional poll interval', { pollIntervalMinutes: 1.5 }],
      ['a non-numeric poll interval', { pollIntervalMinutes: 'five' }],
      ['an over-long cancel list', { cancelResolutions: 'x'.repeat(501) }],
      ['a bad email', { email: 'not-an-email' }],
      ['a missing enabled flag', { enabled: undefined }],
    ])('rejects %s with 400 and never writes', async (_label, overrides) => {
      const { agent } = await loginAsUser(app);

      const response = await agent.put('/api/jira-settings').send(validBody(overrides));

      expect(response.status).toBe(400);
      expect(mockPrismaFunctions.jiraSettings.upsert).not.toHaveBeenCalled();
    });

    test('uppercases the project key and accepts an empty one', async () => {
      const { agent } = await loginAsUser(app);

      const response = await agent.put('/api/jira-settings').send(validBody({ defaultProjectKey: 'ops1' }));

      expect(response.status).toBe(200);
      expect(mockPrismaFunctions.jiraSettings.upsert.mock.calls[0][0].create.defaultProjectKey).toBe('OPS1');
    });
  });

  // -------------------------------------------------------------------------
  // PUT — singleton write semantics
  // -------------------------------------------------------------------------
  describe('PUT /api/jira-settings — singleton write', () => {
    test('upserts on the unique singleton key', async () => {
      const { agent } = await loginAsUser(app);

      await agent.put('/api/jira-settings').send(validBody());

      expect(mockPrismaFunctions.jiraSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { singleton: 'singleton' } })
      );
    });

    test('P2002 (a concurrent first-save) re-reads the winner and answers 200, still masked', async () => {
      const { agent } = await loginAsUser(app);
      mockPrismaFunctions.jiraSettings.upsert.mockRejectedValue(prismaError('P2002'));
      mockPrismaFunctions.jiraSettings.findUnique
        .mockResolvedValueOnce(null) // the pre-write read
        .mockResolvedValueOnce(
          settingsDoc({ enabled: true, baseUrl: 'https://acme.atlassian.net', apiTokenEnc: 'winner-ciphertext' })
        );

      const response = await agent.put('/api/jira-settings').send(validBody({ enabled: true }));

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ enabled: true, hasToken: true });
      expect(response.body).not.toHaveProperty('apiTokenEnc');
      expect(JSON.stringify(response.body)).not.toContain('winner-ciphertext');
    });

    // The health record is STATUS the poller owns: a save must neither carry it as
    // input nor overwrite the verdict, and the response reports it back unchanged.
    test('never writes the health fields, and echoes the stored record back', async () => {
      const { agent } = await loginAsUser(app);
      const failingSince = new Date('2026-08-10T07:30:00.000Z');
      const stored = settingsDoc({
        baseUrl: 'https://acme.atlassian.net',
        email: 'tech@corp.example',
        lastSyncOk: false,
        lastSyncReason: 'invalid_credentials',
        lastSyncAt: failingSince,
      });
      mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(stored);
      mockPrismaFunctions.jiraSettings.upsert.mockImplementation(
        ({ update }: { update: Record<string, unknown> }) => Promise.resolve({ ...stored, ...update })
      );

      // A body that TRIES to set the health fields — they are not part of the schema,
      // so they are dropped rather than persisted.
      const response = await agent.put('/api/jira-settings').send(
        validBody({
          enabled: true,
          baseUrl: 'https://acme.atlassian.net',
          email: 'tech@corp.example',
          lastSyncOk: true,
          lastSyncReason: null,
          lastSync: { ok: true },
        })
      );

      expect(response.status).toBe(200);
      const { create, update } = mockPrismaFunctions.jiraSettings.upsert.mock.calls[0][0];
      for (const field of ['lastSyncOk', 'lastSyncReason', 'lastSyncAt', 'lastSync']) {
        expect(create).not.toHaveProperty(field);
        expect(update).not.toHaveProperty(field);
      }
      expect(response.body.lastSync).toEqual({
        ok: false,
        reason: 'invalid_credentials',
        at: failingSince.toISOString(),
      });
    });

    test('a non-P2002 write failure is a 500 (never a 400)', async () => {
      const { agent } = await loginAsUser(app);
      mockPrismaFunctions.jiraSettings.upsert.mockRejectedValue(new Error('db down'));

      const response = await agent.put('/api/jira-settings').send(validBody());

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });
  });

  // -------------------------------------------------------------------------
  // POST /test and GET /projects — always-200 diagnostics
  // -------------------------------------------------------------------------
  describe('POST /api/jira-settings/test', () => {
    test('returns the structured ok result', async () => {
      const { agent } = await loginAsUser(app);
      mockedTestJira.mockResolvedValue({ ok: true });

      const response = await agent.post('/api/jira-settings/test').send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });

    test('returns the FIXED failure reason only (no upstream text)', async () => {
      const { agent } = await loginAsUser(app);
      mockedTestJira.mockResolvedValue({ ok: false, reason: 'invalid_credentials' });

      const response = await agent.post('/api/jira-settings/test').send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: false, reason: 'invalid_credentials' });
    });

    test('an unexpected throw is a 500 (the helper is documented never-throws)', async () => {
      const { agent } = await loginAsUser(app);
      mockedTestJira.mockRejectedValue(new Error('unexpected'));

      const response = await agent.post('/api/jira-settings/test').send({});

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/jira-settings/projects', () => {
    test('returns the listing on success', async () => {
      const { agent } = await loginAsUser(app);
      mockedListProjects.mockResolvedValue({ ok: true, projects: [{ key: 'OPS', name: 'Operations' }] });

      const response = await agent.get('/api/jira-settings/projects');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ projects: [{ key: 'OPS', name: 'Operations' }] });
    });

    test('ALWAYS answers 200 with an empty list + fixed reason on failure (manual entry fallback)', async () => {
      const { agent } = await loginAsUser(app);
      mockedListProjects.mockResolvedValue({ ok: false, reason: 'config_error' });

      const response = await agent.get('/api/jira-settings/projects');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ projects: [], reason: 'config_error' });
    });

    test('keeps the always-200 shape even if the helper throws unexpectedly', async () => {
      const { agent } = await loginAsUser(app);
      mockedListProjects.mockRejectedValue(new Error('unexpected'));

      const response = await agent.get('/api/jira-settings/projects');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ projects: [], reason: 'unknown' });
    });
  });
});
