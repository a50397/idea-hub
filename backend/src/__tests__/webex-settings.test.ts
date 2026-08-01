import request from 'supertest';
import express from 'express';
import session from 'express-session';
import cors from 'cors';

// Define mock Prisma BEFORE importing routes.
const mockPrismaFunctions: Record<string, any> = {
  user: {
    findUnique: jest.fn(),
  },
  webexSettings: {
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

// Partial mock of utils/webex: the singleton constant / defaults / record type are
// kept REAL (the route imports them), but sendTestWebexMessage is mocked so POST
// /test returns its structured result without touching real HTTP. (Analogous to
// mail-settings.test.ts mocking utils/mailer's sendTestMail; the difference is that
// Webex keeps config + sender in one module, so we mock only the one export.)
jest.mock('../utils/webex', () => {
  const actual = jest.requireActual('../utils/webex');
  return { ...actual, sendTestWebexMessage: jest.fn() };
});

// Import routes AFTER mocks. secretbox is REAL so the "set token" path proves
// genuine encryption (and the test can decrypt the stored ciphertext back).
import bcrypt from 'bcrypt';
import authRoutes from '../routes/auth';
import webexSettingsRoutes from '../routes/webex-settings';
import { sendTestWebexMessage } from '../utils/webex';
import { decrypt } from '../utils/secretbox';

const mockedSendTestWebex = jest.mocked(sendTestWebexMessage);

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
  app.use('/api/webex-settings', webexSettingsRoutes);
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

// A body satisfying updateWebexSettingsSchema (token is the only optional field).
function validBody(overrides: Record<string, unknown> = {}) {
  return {
    enabled: false,
    language: 'sk',
    ...overrides,
  };
}

// Build a stored document.
function settingsDoc(overrides: Record<string, unknown> = {}) {
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

describe('Webex settings API', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
    // Default: echo the upserted UPDATE payload back so the masked response reflects
    // persistence. Tests that assert the write shape inspect the upsert call directly.
    mockPrismaFunctions.webexSettings.upsert.mockImplementation(
      ({ update }: { update: Record<string, unknown> }) =>
        Promise.resolve({ ...settingsDoc(), ...update })
    );
  });

  // -------------------------------------------------------------------------
  // Authz: 401 unauthenticated, 403 for non-admins, on every endpoint.
  // -------------------------------------------------------------------------
  describe('authorization', () => {
    const endpoints: Array<[string, string, Record<string, unknown> | undefined]> = [
      ['get', '/api/webex-settings', undefined],
      ['put', '/api/webex-settings', validBody()],
      ['post', '/api/webex-settings/test', { to: 'x@example.com' }],
    ];

    for (const [method, path, body] of endpoints) {
      test(`returns 401 when unauthenticated on ${method.toUpperCase()} ${path}`, async () => {
        let req = (request(app) as any)[method](path);
        if (body) req = req.send(body);
        const response = await req;
        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty('error');
      });
    }

    for (const role of ['USER', 'POWER_USER']) {
      for (const [method, path, body] of endpoints) {
        test(`${role} gets 403 on ${method.toUpperCase()} ${path}`, async () => {
          const { agent } = await loginAsUser(app, role);
          let req = (agent as any)[method](path);
          if (body) req = req.send(body);
          const response = await req;
          expect(response.status).toBe(403);
          expect(response.body).toHaveProperty('error');
          // A non-admin must never trigger a write or a send.
          expect(mockPrismaFunctions.webexSettings.upsert).not.toHaveBeenCalled();
          expect(mockedSendTestWebex).not.toHaveBeenCalled();
        });
      }
    }
  });

  // -------------------------------------------------------------------------
  // GET: masking + hasToken in both states + defaults when absent.
  // -------------------------------------------------------------------------
  describe('GET /api/webex-settings', () => {
    test('never exposes the token and reports hasToken=true when one is stored', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.webexSettings.findUnique.mockResolvedValue(
        settingsDoc({ enabled: true, language: 'en', botTokenEnc: 'stored-ciphertext-value' })
      );

      const response = await agent.get('/api/webex-settings');

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('botTokenEnc');
      expect(response.body).not.toHaveProperty('token');
      expect(response.body.hasToken).toBe(true);
      expect(JSON.stringify(response.body)).not.toContain('stored-ciphertext-value');
      expect(response.body).toMatchObject({ enabled: true, language: 'en' });
    });

    test('reports hasToken=false when no token is stored', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.webexSettings.findUnique.mockResolvedValue(settingsDoc({ botTokenEnc: null }));

      const response = await agent.get('/api/webex-settings');

      expect(response.status).toBe(200);
      expect(response.body.hasToken).toBe(false);
      expect(response.body).not.toHaveProperty('botTokenEnc');
    });

    test('returns disabled defaults (sk, hasToken=false) when no document exists yet', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.webexSettings.findUnique.mockResolvedValue(null);

      const response = await agent.get('/api/webex-settings');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ enabled: false, language: 'sk', hasToken: false });
      expect(response.body).not.toHaveProperty('botTokenEnc');
    });
  });

  // -------------------------------------------------------------------------
  // PUT: token keep/set/wipe + masking on the way out + P2002 convergence.
  // -------------------------------------------------------------------------
  describe('PUT /api/webex-settings', () => {
    test('creates the first document (via upsert on the singleton key) and returns a masked shape', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.webexSettings.findUnique.mockResolvedValue(null);

      const response = await agent.put('/api/webex-settings').send(validBody({ enabled: false }));

      expect(response.status).toBe(200);
      expect(mockPrismaFunctions.webexSettings.upsert).toHaveBeenCalledTimes(1);
      const call = mockPrismaFunctions.webexSettings.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ singleton: 'singleton' });
      // No token supplied and none existing -> stored empty.
      expect(call.create.botTokenEnc).toBe('');
      expect(response.body).not.toHaveProperty('botTokenEnc');
      expect(response.body.hasToken).toBe(false);
    });

    test('first-ever save carrying an EXPLICIT empty token wipes on create (botTokenEnc "" on BOTH create and update)', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.webexSettings.findUnique.mockResolvedValue(null); // no document yet

      const response = await agent.put('/api/webex-settings').send(validBody({ token: '' }));

      expect(response.status).toBe(200);
      const call = mockPrismaFunctions.webexSettings.upsert.mock.calls[0][0];
      // An explicit empty token is a WIPE (changesToken=true) — distinct from the
      // no-token KEEP branch above: the UPDATE WRITES '' (not omitted) AND create
      // carries ''. This is the create-branch wipe path.
      expect(call.create.botTokenEnc).toBe('');
      expect(call.update.botTokenEnc).toBe('');
      expect('botTokenEnc' in call.update).toBe(true);
      expect(response.body).not.toHaveProperty('botTokenEnc');
      expect(response.body.hasToken).toBe(false);
    });

    test('converges to 200 by re-reading the winner when the upsert loses the unique-singleton race (P2002)', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      const persisted = settingsDoc({
        id: 'winner',
        enabled: true,
        language: 'en',
        botTokenEnc: 'winner-ciphertext',
      });
      mockPrismaFunctions.webexSettings.findUnique
        .mockResolvedValueOnce(null) // pre-write existing lookup
        .mockResolvedValueOnce(persisted); // convergence re-read after P2002
      mockPrismaFunctions.webexSettings.upsert.mockRejectedValue(prismaError('P2002'));

      const response = await agent
        .put('/api/webex-settings')
        .send(validBody({ enabled: true, language: 'en', token: 'concurrent-secret' }));

      expect(response.status).toBe(200);
      expect(mockPrismaFunctions.webexSettings.findUnique).toHaveBeenCalledTimes(2);
      expect(mockPrismaFunctions.webexSettings.findUnique).toHaveBeenLastCalledWith({
        where: { singleton: 'singleton' },
      });
      // Masked convergence body — no secret material leaks.
      expect(response.body.hasToken).toBe(true);
      expect(response.body).not.toHaveProperty('botTokenEnc');
      expect(response.body).not.toHaveProperty('token');
      expect(JSON.stringify(response.body)).not.toContain('winner-ciphertext');
      expect(JSON.stringify(response.body)).not.toContain('concurrent-secret');
      expect(response.body).toMatchObject({ enabled: true, language: 'en' });
    });

    test('a NON-P2002 upsert rejection still returns 500 and does not re-read', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.webexSettings.findUnique.mockResolvedValue(null);
      mockPrismaFunctions.webexSettings.upsert.mockRejectedValue(prismaError('P2000'));
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      try {
        const response = await agent.put('/api/webex-settings').send(validBody());

        expect(response.status).toBe(500);
        expect(response.body).toHaveProperty('error');
        expect(mockPrismaFunctions.webexSettings.findUnique).toHaveBeenCalledTimes(1);
      } finally {
        errorSpy.mockRestore();
      }
    });

    test('encrypts and stores a NEW token (set path); ciphertext != plaintext', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.webexSettings.findUnique.mockResolvedValue(settingsDoc({ id: 's1', botTokenEnc: null }));

      const response = await agent
        .put('/api/webex-settings')
        .send(validBody({ enabled: true, token: 'new-bot-token-value' }));

      expect(response.status).toBe(200);
      const savedData = mockPrismaFunctions.webexSettings.upsert.mock.calls[0][0].update;
      expect(savedData.botTokenEnc).not.toBe('new-bot-token-value');
      expect(savedData.botTokenEnc.length).toBeGreaterThan(0);
      // Prove it is a real, reversible encryption of the submitted token.
      expect(decrypt(savedData.botTokenEnc)).toBe('new-bot-token-value');
      // The response never echoes the token back.
      expect(response.body).not.toHaveProperty('token');
      expect(response.body).not.toHaveProperty('botTokenEnc');
      expect(response.body.hasToken).toBe(true);
    });

    test('KEEPS the existing token when none is provided (keep path): update OMITS botTokenEnc, create carries it', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.webexSettings.findUnique.mockResolvedValue(
        settingsDoc({ id: 's1', enabled: true, botTokenEnc: 'EXISTING_ENC' })
      );

      const response = await agent.put('/api/webex-settings').send(validBody({ enabled: true })); // no token key

      expect(response.status).toBe(200);
      const call = mockPrismaFunctions.webexSettings.upsert.mock.calls[0][0];
      // KEEP: the UPDATE payload OMITS botTokenEnc so Prisma leaves the stored
      // ciphertext untouched (no lost update); CREATE carries the kept ciphertext.
      expect(call.update).not.toHaveProperty('botTokenEnc');
      expect('botTokenEnc' in call.update).toBe(false);
      expect(call.create.botTokenEnc).toBe('EXISTING_ENC');
    });

    test('WIPES the stored token when an empty-string token is submitted (wipe path)', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.webexSettings.findUnique.mockResolvedValue(
        settingsDoc({ id: 's1', enabled: true, botTokenEnc: 'EXISTING_ENC' })
      );

      const response = await agent.put('/api/webex-settings').send(validBody({ enabled: true, token: '' }));

      expect(response.status).toBe(200);
      const call = mockPrismaFunctions.webexSettings.upsert.mock.calls[0][0];
      // Empty-string token is a WIPE (unlike mail, which treats it as keep): the
      // UPDATE writes an empty botTokenEnc.
      expect(call.update.botTokenEnc).toBe('');
      expect(call.create.botTokenEnc).toBe('');
    });

    test('trims nothing it should not: rejects an unsupported language with a concise 400 and never writes', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.webexSettings.findUnique.mockResolvedValue(null);

      const response = await agent.put('/api/webex-settings').send(validBody({ language: 'de' }));

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Language must be en or sk');
      expect(response.body.error).not.toContain('"code"');
      expect(response.body.error).not.toContain('[');
      expect(mockPrismaFunctions.webexSettings.upsert).not.toHaveBeenCalled();
    });

    test('rejects an over-long token with 400 and never writes', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.webexSettings.findUnique.mockResolvedValue(null);

      const response = await agent
        .put('/api/webex-settings')
        .send(validBody({ token: 'a'.repeat(513) }));

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(mockPrismaFunctions.webexSettings.upsert).not.toHaveBeenCalled();
    });

    test('rejects a non-boolean enabled with 400 and never writes', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.webexSettings.findUnique.mockResolvedValue(null);

      const response = await agent.put('/api/webex-settings').send({ enabled: 'yes', language: 'sk' });

      expect(response.status).toBe(400);
      expect(mockPrismaFunctions.webexSettings.upsert).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // POST /test: calls sendTestWebexMessage and returns its structured result
  // verbatim (always 200; the `ok` field is the outcome).
  // -------------------------------------------------------------------------
  describe('POST /api/webex-settings/test', () => {
    test('calls sendTestWebexMessage with the recipient and returns { ok: true }', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockedSendTestWebex.mockResolvedValue({ ok: true });

      const response = await agent.post('/api/webex-settings/test').send({ to: 'admin@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
      expect(mockedSendTestWebex).toHaveBeenCalledTimes(1);
      expect(mockedSendTestWebex.mock.calls[0][0]).toBe('admin@example.com');
    });

    test('passes a failed result (fixed reason only) through as 200; no extra fields', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockedSendTestWebex.mockResolvedValue({ ok: false, reason: 'invalid_token' });

      const response = await agent.post('/api/webex-settings/test').send({ to: 'admin@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: false, reason: 'invalid_token' });
      expect(response.body).not.toHaveProperty('status');
      expect(response.body).not.toHaveProperty('error');
    });

    test('passes a config_error result straight through as 200', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockedSendTestWebex.mockResolvedValue({ ok: false, reason: 'config_error' });

      const response = await agent.post('/api/webex-settings/test').send({ to: 'admin@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: false, reason: 'config_error' });
    });

    test('rejects an invalid recipient with 400 (concise message) and never sends', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const response = await agent.post('/api/webex-settings/test').send({ to: 'not-an-email' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid email address');
      expect(response.body.error).not.toContain('"code"');
      expect(mockedSendTestWebex).not.toHaveBeenCalled();
    });
  });
});
