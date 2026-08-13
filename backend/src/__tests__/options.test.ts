import request from 'supertest';
import express from 'express';
import session from 'express-session';
import cors from 'cors';

// Define mock Prisma BEFORE importing routes. GET /options ->
// getEffectiveMailConfig reads the singleton MailSettings via
// prisma.mailSettings.findUnique, getEffectiveWebexConfig reads the singleton
// WebexSettings via prisma.webexSettings.findUnique and getEffectiveJiraConfig reads
// the singleton JiraSettings via prisma.jiraSettings.findUnique; the login helper
// (used to obtain a session) reads prisma.user.findUnique.
const mockPrismaFunctions: Record<string, any> = {
  user: {
    findUnique: jest.fn(),
  },
  mailSettings: {
    findUnique: jest.fn(),
  },
  webexSettings: {
    findUnique: jest.fn(),
  },
  jiraSettings: {
    findUnique: jest.fn(),
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

// Import routes AFTER mocks. config/mail, utils/webex and config/sso are REAL (not
// mocked): mailEnabled/webexEnabled derive from the (mocked) settings documents via
// the same getEffectiveMailConfig/getEffectiveWebexConfig the senders use, and
// ssoShowLogout derives from the real SSO_SHOW_LOGOUT env read — exactly as in
// production. secretbox is real so the token decryption that gates webexEnabled is
// genuine.
import bcrypt from 'bcrypt';
import authRoutes from '../routes/auth';
import optionsRoutes from '../routes/options';
import { encrypt } from '../utils/secretbox';

// 64 hex chars == 32 bytes. getEffectiveMailConfig only decrypts when a password
// ciphertext is stored (these tests never store one), but set a valid key so the
// real config module is fully usable regardless.
const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
let savedKey: string | undefined;
let savedShowLogout: string | undefined;

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
  app.use('/api/options', optionsRoutes);
  return app;
}

// Obtain an authenticated session via a real local login (default: a regular USER).
async function loginAsUser(app: express.Application, role: string = 'USER') {
  const agent = request.agent(app);
  const user = {
    id: 'user123',
    name: 'Test User',
    email: 'user@example.com',
    passwordHash: 'hash',
    role,
  };
  mockPrismaFunctions.user.findUnique.mockResolvedValue(user);
  (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  await agent.post('/api/auth/login').send({ email: 'user@example.com', password: 'password123' });
  return { agent, user };
}

// A stored MailSettings document (only the fields getEffectiveMailConfig reads
// matter here). Mirrors the helper in mail-settings.test.ts.
function settingsDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'settings1',
    enabled: false,
    host: '',
    port: 587,
    secure: false,
    username: '',
    passwordEnc: '',
    from: 'IdeaHub <no-reply@ideahub.local>',
    language: 'en',
    subjectTemplate: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// A stored JiraSettings document (only the fields getEffectiveJiraConfig reads
// matter here). jiraEnabled requires enabled AND baseUrl AND email AND a usable
// (decryptable) token — the strictest of the three channels, because email+token is
// the Basic credential and baseUrl is where it would be sent.
function jiraDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'jira1',
    singleton: 'singleton',
    enabled: false,
    baseUrl: '',
    email: '',
    apiTokenEnc: null,
    defaultProjectKey: '',
    issueTypeName: 'Task',
    pollIntervalMinutes: 5,
    cancelResolutions: "Won't Do,Cancelled,Duplicate",
    // The poller-written health record (see routes/options.ts jiraSyncFailing);
    // null = no outcome recorded yet.
    lastSyncOk: null,
    lastSyncReason: null,
    lastSyncAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// A stored JiraSettings document whose poller has recorded an outcome.
function jiraDocWithSync(lastSyncOk: boolean | null, overrides: Record<string, unknown> = {}) {
  return jiraDoc({
    enabled: true,
    baseUrl: 'https://acme.atlassian.net',
    email: 'tech@corp.example',
    apiTokenEnc: encrypt('jira-api-token'),
    lastSyncOk,
    lastSyncReason: lastSyncOk === false ? 'invalid_credentials' : null,
    lastSyncAt: lastSyncOk === null ? null : new Date('2026-08-10T07:30:00.000Z'),
    ...overrides,
  });
}

// A stored WebexSettings document (only the fields getEffectiveWebexConfig reads
// matter here). Mirrors the helper in webex-settings.test.ts.
function webexDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'webex1',
    singleton: 'singleton',
    enabled: false,
    botTokenEnc: null,
    language: 'sk',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeAll(() => {
  savedKey = process.env.MAIL_SETTINGS_KEY;
  process.env.MAIL_SETTINGS_KEY = TEST_KEY;
  savedShowLogout = process.env.SSO_SHOW_LOGOUT;
});

afterAll(() => {
  if (savedKey === undefined) delete process.env.MAIL_SETTINGS_KEY;
  else process.env.MAIL_SETTINGS_KEY = savedKey;
  if (savedShowLogout === undefined) delete process.env.SSO_SHOW_LOGOUT;
  else process.env.SSO_SHOW_LOGOUT = savedShowLogout;
});

describe('Options API', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
    // Hermetic default: the env-derived logout flag is off unless a test opts in.
    delete process.env.SSO_SHOW_LOGOUT;
    // Hermetic default: Webex disabled (no document) unless a test overrides it, so
    // webexEnabled defaults false the same way mailEnabled does.
    mockPrismaFunctions.webexSettings.findUnique.mockResolvedValue(null);
    // Same for Jira; also drop the env base-URL override so the DB value decides.
    mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(null);
    delete process.env.JIRA_API_BASE_URL;
  });

  test('returns 401 when unauthenticated', async () => {
    const response = await request(app).get('/api/options');

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('error');
  });

  test('returns 200 with all flags (all false by default) for an authenticated regular user', async () => {
    const { agent } = await loginAsUser(app, 'USER');
    mockPrismaFunctions.mailSettings.findUnique.mockResolvedValue(null);

    const response = await agent.get('/api/options');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      mailEnabled: false,
      webexEnabled: false,
      jiraEnabled: false,
      ssoShowLogout: false,
    });
  });

  test('mailEnabled is true when mail is effectively enabled (enabled AND host)', async () => {
    const { agent } = await loginAsUser(app, 'USER');
    mockPrismaFunctions.mailSettings.findUnique.mockResolvedValue(
      settingsDoc({ enabled: true, host: 'smtp.corp.example' })
    );

    const response = await agent.get('/api/options');

    expect(response.status).toBe(200);
    expect(response.body.mailEnabled).toBe(true);
  });

  test('mailEnabled is false when enabled but the host is empty (half-configured is not effective)', async () => {
    const { agent } = await loginAsUser(app, 'USER');
    mockPrismaFunctions.mailSettings.findUnique.mockResolvedValue(
      settingsDoc({ enabled: true, host: '' })
    );

    const response = await agent.get('/api/options');

    expect(response.status).toBe(200);
    expect(response.body.mailEnabled).toBe(false);
  });

  test('webexEnabled is true when Webex is effectively enabled (enabled AND a usable token)', async () => {
    const { agent } = await loginAsUser(app, 'USER');
    mockPrismaFunctions.mailSettings.findUnique.mockResolvedValue(null);
    mockPrismaFunctions.webexSettings.findUnique.mockResolvedValue(
      webexDoc({ enabled: true, botTokenEnc: encrypt('bot-token-xyz') })
    );

    const response = await agent.get('/api/options');

    expect(response.status).toBe(200);
    expect(response.body.webexEnabled).toBe(true);
    // The two channels are independent — mail stays off here.
    expect(response.body.mailEnabled).toBe(false);
  });

  test('webexEnabled is false when enabled but no token is stored (half-configured is not effective)', async () => {
    const { agent } = await loginAsUser(app, 'USER');
    mockPrismaFunctions.mailSettings.findUnique.mockResolvedValue(null);
    mockPrismaFunctions.webexSettings.findUnique.mockResolvedValue(
      webexDoc({ enabled: true, botTokenEnc: null })
    );

    const response = await agent.get('/api/options');

    expect(response.status).toBe(200);
    expect(response.body.webexEnabled).toBe(false);
  });

  test('jiraEnabled is true only when enabled AND baseUrl AND email AND a usable token', async () => {
    const { agent } = await loginAsUser(app, 'USER');
    mockPrismaFunctions.mailSettings.findUnique.mockResolvedValue(null);
    mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(
      jiraDoc({
        enabled: true,
        baseUrl: 'https://acme.atlassian.net',
        email: 'tech@corp.example',
        apiTokenEnc: encrypt('jira-api-token'),
      })
    );

    const response = await agent.get('/api/options');

    expect(response.status).toBe(200);
    expect(response.body.jiraEnabled).toBe(true);
    // Independent of the other two channels.
    expect(response.body.mailEnabled).toBe(false);
    expect(response.body.webexEnabled).toBe(false);
  });

  test.each([
    ['no token stored', { enabled: true, baseUrl: 'https://acme.atlassian.net', email: 'tech@corp.example' }],
    ['no base URL', { enabled: true, email: 'tech@corp.example', apiTokenEnc: 'ENCRYPTED' }],
    ['no account email', { enabled: true, baseUrl: 'https://acme.atlassian.net', apiTokenEnc: 'ENCRYPTED' }],
    [
      'disabled despite a full config',
      {
        enabled: false,
        baseUrl: 'https://acme.atlassian.net',
        email: 'tech@corp.example',
        apiTokenEnc: 'ENCRYPTED',
      },
    ],
    [
      'a stored token that will not decrypt',
      {
        enabled: true,
        baseUrl: 'https://acme.atlassian.net',
        email: 'tech@corp.example',
        apiTokenEnc: 'not-valid-ciphertext',
      },
    ],
  ])('jiraEnabled is false when half-configured: %s', async (_label, overrides) => {
    const { agent } = await loginAsUser(app, 'USER');
    mockPrismaFunctions.mailSettings.findUnique.mockResolvedValue(null);
    const raw = overrides as Record<string, unknown>;
    // The 'ENCRYPTED' placeholder above stands for a genuinely usable token.
    const doc = jiraDoc(
      raw.apiTokenEnc === 'ENCRYPTED' ? { ...raw, apiTokenEnc: encrypt('jira-api-token') } : raw
    );
    mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(doc);

    const response = await agent.get('/api/options');

    expect(response.status).toBe(200);
    expect(response.body.jiraEnabled).toBe(false);
  });

  test('the two channel flags are independent (webex on, mail on, together)', async () => {
    const { agent } = await loginAsUser(app, 'USER');
    mockPrismaFunctions.mailSettings.findUnique.mockResolvedValue(
      settingsDoc({ enabled: true, host: 'smtp.corp.example' })
    );
    mockPrismaFunctions.webexSettings.findUnique.mockResolvedValue(
      webexDoc({ enabled: true, botTokenEnc: encrypt('bot-token-xyz') })
    );

    const response = await agent.get('/api/options');

    expect(response.status).toBe(200);
    expect(response.body.mailEnabled).toBe(true);
    expect(response.body.webexEnabled).toBe(true);
  });

  test('ssoShowLogout is true only when SSO_SHOW_LOGOUT=true', async () => {
    process.env.SSO_SHOW_LOGOUT = 'true';
    const { agent } = await loginAsUser(app, 'USER');
    mockPrismaFunctions.mailSettings.findUnique.mockResolvedValue(null);

    const response = await agent.get('/api/options');

    expect(response.status).toBe(200);
    expect(response.body.ssoShowLogout).toBe(true);
  });

  test('responds with EXACTLY the flag fields — no config or secret leak from either channel', async () => {
    process.env.SSO_SHOW_LOGOUT = 'true';
    const { agent } = await loginAsUser(app, 'USER');
    // Fully populated (secret-bearing) documents for BOTH channels must still yield
    // only the flags.
    mockPrismaFunctions.mailSettings.findUnique.mockResolvedValue(
      settingsDoc({
        enabled: true,
        host: 'smtp.corp.example',
        username: 'relay-user',
        passwordEnc: 'stored-ciphertext-value',
      })
    );
    mockPrismaFunctions.webexSettings.findUnique.mockResolvedValue(
      webexDoc({ enabled: true, botTokenEnc: encrypt('bot-token-secret-value') })
    );
    mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(
      jiraDoc({
        enabled: true,
        baseUrl: 'https://acme.atlassian.net',
        email: 'tech@corp.example',
        defaultProjectKey: 'OPS',
        apiTokenEnc: encrypt('jira-token-secret-value'),
      })
    );

    const response = await agent.get('/api/options');

    expect(response.status).toBe(200);
    // Exactly the four documented flags — nothing more.
    expect(Object.keys(response.body).sort()).toEqual([
      'jiraEnabled',
      'mailEnabled',
      'ssoShowLogout',
      'webexEnabled',
    ]);
    expect(response.body).toEqual({
      mailEnabled: true,
      webexEnabled: true,
      jiraEnabled: true,
      ssoShowLogout: true,
    });
    // No admin configuration, no public auth-config flag, and no secret material leaks.
    expect(response.body).not.toHaveProperty('host');
    expect(response.body).not.toHaveProperty('username');
    expect(response.body).not.toHaveProperty('passwordEnc');
    expect(response.body).not.toHaveProperty('botTokenEnc');
    expect(response.body).not.toHaveProperty('token');
    expect(response.body).not.toHaveProperty('ssoEnabled');
    // Nor any Jira configuration — the base URL and account email are admin-only,
    // and the token must never appear in any form.
    expect(response.body).not.toHaveProperty('baseUrl');
    expect(response.body).not.toHaveProperty('email');
    expect(response.body).not.toHaveProperty('apiTokenEnc');
    expect(response.body).not.toHaveProperty('defaultProjectKey');
    expect(JSON.stringify(response.body)).not.toContain('stored-ciphertext-value');
    expect(JSON.stringify(response.body)).not.toContain('bot-token-secret-value');
    expect(JSON.stringify(response.body)).not.toContain('jira-token-secret-value');
    expect(JSON.stringify(response.body)).not.toContain('acme.atlassian.net');
  });

  // -------------------------------------------------------------------------
  // jiraSyncFailing — the one ROLE-GATED field on this endpoint. It reports that
  // the Jira background poller is currently failing, which only an ADMIN can act
  // on, so it is ABSENT (not false) for every other role.
  // -------------------------------------------------------------------------
  describe('jiraSyncFailing (ADMIN only)', () => {
    test('is true for an ADMIN when Jira is enabled and the last recorded sync failed', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.mailSettings.findUnique.mockResolvedValue(null);
      mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(jiraDocWithSync(false));

      const response = await agent.get('/api/options');

      expect(response.status).toBe(200);
      expect(response.body.jiraSyncFailing).toBe(true);
    });

    test('is false for an ADMIN when the last recorded sync succeeded', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.mailSettings.findUnique.mockResolvedValue(null);
      mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(jiraDocWithSync(true));

      const response = await agent.get('/api/options');

      expect(response.status).toBe(200);
      expect(response.body.jiraSyncFailing).toBe(false);
    });

    test('is false for an ADMIN when nothing has been recorded yet (never polled)', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.mailSettings.findUnique.mockResolvedValue(null);
      mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(jiraDocWithSync(null));

      const response = await agent.get('/api/options');

      expect(response.body.jiraSyncFailing).toBe(false);
    });

    // A switched-off integration is not "failing", however stale the last verdict
    // is: nothing is polling, so there is nothing for the admin to fix.
    test('is false for an ADMIN when the integration is disabled, even with a stored failure', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.mailSettings.findUnique.mockResolvedValue(null);
      mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(
        jiraDocWithSync(false, { enabled: false })
      );

      const response = await agent.get('/api/options');

      expect(response.body.jiraSyncFailing).toBe(false);
    });

    // The key rotation case: the stored token no longer decrypts, so jiraEnabled
    // (effectiveEnabled) is FALSE while the failure is real — the flag must still
    // raise it, which is why it keys off `enabled`, not `jiraEnabled`.
    test('stays true for an ADMIN when an undecryptable token already turned jiraEnabled off', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.mailSettings.findUnique.mockResolvedValue(null);
      mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(
        jiraDocWithSync(false, { apiTokenEnc: 'not-valid-ciphertext', lastSyncReason: 'config_error' })
      );

      const response = await agent.get('/api/options');

      expect(response.body.jiraEnabled).toBe(false);
      expect(response.body.jiraSyncFailing).toBe(true);
    });

    test.each(['USER', 'POWER_USER'])(
      'the key is completely ABSENT for a %s, even while the sync is failing',
      async (role) => {
        const { agent } = await loginAsUser(app, role);
        mockPrismaFunctions.mailSettings.findUnique.mockResolvedValue(null);
        mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(jiraDocWithSync(false));

        const response = await agent.get('/api/options');

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('jiraSyncFailing');
        // Byte for byte the response a non-admin always got.
        expect(Object.keys(response.body).sort()).toEqual([
          'jiraEnabled',
          'mailEnabled',
          'ssoShowLogout',
          'webexEnabled',
        ]);
      }
    );

    test('an ADMIN response adds the flag and NOTHING else (no failure reason, no config)', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.mailSettings.findUnique.mockResolvedValue(null);
      mockPrismaFunctions.jiraSettings.findUnique.mockResolvedValue(
        jiraDocWithSync(false, { apiTokenEnc: encrypt('jira-token-secret-value'), defaultProjectKey: 'OPS' })
      );

      const response = await agent.get('/api/options');

      expect(Object.keys(response.body).sort()).toEqual([
        'jiraEnabled',
        'jiraSyncFailing',
        'mailEnabled',
        'ssoShowLogout',
        'webexEnabled',
      ]);
      // The REASON stays on the admin-only settings endpoint; this is a bare boolean.
      expect(JSON.stringify(response.body)).not.toContain('invalid_credentials');
      expect(JSON.stringify(response.body)).not.toContain('jira-token-secret-value');
      expect(JSON.stringify(response.body)).not.toContain('acme.atlassian.net');
    });
  });
});
