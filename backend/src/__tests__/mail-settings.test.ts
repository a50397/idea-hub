import request from 'supertest';
import express from 'express';
import session from 'express-session';
import cors from 'cors';

// Define mock Prisma BEFORE importing routes.
const mockPrismaFunctions: Record<string, any> = {
  user: {
    findUnique: jest.fn(),
  },
  mailSettings: {
    findFirst: jest.fn(),
    // The PUT write path is now a single atomic upsert on the unique singleton key.
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

// The mailer is fully mocked: POST /test must call sendTestMail and return its
// structured result without touching real SMTP (or the DB-backed config).
jest.mock('../utils/mailer', () => ({
  sendMail: jest.fn(),
  sendTestMail: jest.fn(),
}));

// Import routes AFTER mocks. secretbox is REAL so the "set password" path proves
// genuine encryption (and the test can decrypt the stored ciphertext back).
import bcrypt from 'bcrypt';
import authRoutes from '../routes/auth';
import mailSettingsRoutes from '../routes/mail-settings';
import { sendTestMail } from '../utils/mailer';
import { decrypt } from '../utils/secretbox';

const mockedSendTestMail = jest.mocked(sendTestMail);

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
  app.use('/api/mail-settings', mailSettingsRoutes);
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

// A body satisfying updateMailSettingsSchema (every field except password required).
function validBody(overrides: Record<string, unknown> = {}) {
  return {
    enabled: false,
    host: 'smtp.corp.example',
    port: 2525,
    secure: false,
    username: '',
    from: 'IdeaHub <no-reply@ideahub.local>',
    language: 'en',
    subjectTemplate: '',
    ...overrides,
  };
}

// Build a stored document. update is wired to echo the saved `data` back so the
// masked response reflects what was persisted.
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

beforeAll(() => {
  savedKey = process.env.MAIL_SETTINGS_KEY;
  process.env.MAIL_SETTINGS_KEY = TEST_KEY;
});

afterAll(() => {
  if (savedKey === undefined) delete process.env.MAIL_SETTINGS_KEY;
  else process.env.MAIL_SETTINGS_KEY = savedKey;
});

describe('Mail settings API', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
    // Default: echo the upserted values back so the masked response reflects
    // persistence. The route passes the SAME `values` object as both `create` and
    // `update`, so echoing `update` covers the create-first and update paths alike.
    mockPrismaFunctions.mailSettings.upsert.mockImplementation(
      ({ update }: { update: Record<string, unknown> }) =>
        Promise.resolve({ ...settingsDoc(), ...update })
    );
  });

  // -------------------------------------------------------------------------
  // Authz: 401 unauthenticated, 403 for non-admins, on every endpoint.
  // -------------------------------------------------------------------------
  describe('authorization', () => {
    const endpoints: Array<[string, string, Record<string, unknown> | undefined]> = [
      ['get', '/api/mail-settings', undefined],
      ['put', '/api/mail-settings', validBody()],
      ['post', '/api/mail-settings/test', { to: 'x@example.com' }],
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
          expect(mockPrismaFunctions.mailSettings.upsert).not.toHaveBeenCalled();
          expect(mockedSendTestMail).not.toHaveBeenCalled();
        });
      }
    }
  });

  // -------------------------------------------------------------------------
  // GET: masking + hasPassword in both states + defaults when absent.
  // -------------------------------------------------------------------------
  describe('GET /api/mail-settings', () => {
    test('never exposes the password and reports hasPassword=true when one is stored', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.mailSettings.findFirst.mockResolvedValue(
        settingsDoc({ enabled: true, host: 'smtp.corp.example', username: 'relay-user', passwordEnc: 'stored-ciphertext-value' })
      );

      const response = await agent.get('/api/mail-settings');

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('passwordEnc');
      expect(response.body).not.toHaveProperty('password');
      expect(response.body.hasPassword).toBe(true);
      expect(JSON.stringify(response.body)).not.toContain('stored-ciphertext-value');
      expect(response.body).toMatchObject({
        enabled: true,
        host: 'smtp.corp.example',
        username: 'relay-user',
      });
    });

    test('reports hasPassword=false when no password is stored', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.mailSettings.findFirst.mockResolvedValue(settingsDoc({ passwordEnc: '' }));

      const response = await agent.get('/api/mail-settings');

      expect(response.status).toBe(200);
      expect(response.body.hasPassword).toBe(false);
      expect(response.body).not.toHaveProperty('passwordEnc');
    });

    test('returns disabled defaults (hasPassword=false) when no document exists yet', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.mailSettings.findFirst.mockResolvedValue(null);

      const response = await agent.get('/api/mail-settings');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        enabled: false,
        host: '',
        port: 587,
        secure: false,
        username: '',
        language: 'en',
        subjectTemplate: '',
        hasPassword: false,
      });
      expect(response.body).not.toHaveProperty('passwordEnc');
    });
  });

  // -------------------------------------------------------------------------
  // PUT: save-time validation + password keep/set/wipe + masking on the way out.
  // -------------------------------------------------------------------------
  describe('PUT /api/mail-settings', () => {
    test('creates the first document (via upsert on the singleton key) and returns a masked shape', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.mailSettings.findFirst.mockResolvedValue(null);

      const response = await agent.put('/api/mail-settings').send(validBody({ host: 'smtp.corp.example' }));

      expect(response.status).toBe(200);
      expect(mockPrismaFunctions.mailSettings.upsert).toHaveBeenCalledTimes(1);
      const call = mockPrismaFunctions.mailSettings.upsert.mock.calls[0][0];
      // The atomic write keys on the DB-enforced singleton, so at most one doc exists.
      expect(call.where).toEqual({ singleton: 'singleton' });
      expect(call.create.passwordEnc).toBe(''); // username empty -> no password
      expect(response.body).not.toHaveProperty('passwordEnc');
      expect(response.body.hasPassword).toBe(false);
    });

    test('rejects enabled=true with an empty host (400) and never writes', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.mailSettings.findFirst.mockResolvedValue(null);

      const response = await agent.put('/api/mail-settings').send(validBody({ enabled: true, host: '' }));

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(mockPrismaFunctions.mailSettings.upsert).not.toHaveBeenCalled();
    });

    test('encrypts and stores a NEW password (set path); ciphertext != plaintext', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.mailSettings.findFirst.mockResolvedValue(settingsDoc({ id: 's1', passwordEnc: '' }));

      const response = await agent
        .put('/api/mail-settings')
        .send(validBody({ username: 'relay-user', password: 'new-secret-pass' }));

      expect(response.status).toBe(200);
      expect(mockPrismaFunctions.mailSettings.upsert).toHaveBeenCalledTimes(1);
      const savedData = mockPrismaFunctions.mailSettings.upsert.mock.calls[0][0].update;
      expect(savedData.passwordEnc).not.toBe('new-secret-pass');
      expect(savedData.passwordEnc.length).toBeGreaterThan(0);
      // Prove it is a real, reversible encryption of the submitted secret.
      expect(decrypt(savedData.passwordEnc)).toBe('new-secret-pass');
      // The response never echoes the password back.
      expect(response.body).not.toHaveProperty('password');
      expect(response.body).not.toHaveProperty('passwordEnc');
      expect(response.body.hasPassword).toBe(true);
    });

    test('KEEPS the existing password when none is provided (keep path)', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.mailSettings.findFirst.mockResolvedValue(
        settingsDoc({ id: 's1', username: 'relay-user', passwordEnc: 'EXISTING_ENC' })
      );

      const response = await agent
        .put('/api/mail-settings')
        .send(validBody({ username: 'relay-user' })); // no password key

      expect(response.status).toBe(200);
      const savedData = mockPrismaFunctions.mailSettings.upsert.mock.calls[0][0].update;
      expect(savedData.passwordEnc).toBe('EXISTING_ENC');
    });

    test('treats an empty-string password as "keep" (not a wipe)', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.mailSettings.findFirst.mockResolvedValue(
        settingsDoc({ id: 's1', username: 'relay-user', passwordEnc: 'EXISTING_ENC' })
      );

      const response = await agent
        .put('/api/mail-settings')
        .send(validBody({ username: 'relay-user', password: '' }));

      expect(response.status).toBe(200);
      const savedData = mockPrismaFunctions.mailSettings.upsert.mock.calls[0][0].update;
      expect(savedData.passwordEnc).toBe('EXISTING_ENC');
    });

    test('WIPES the stored password when the username is saved empty (wipe path)', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.mailSettings.findFirst.mockResolvedValue(
        settingsDoc({ id: 's1', username: 'relay-user', passwordEnc: 'EXISTING_ENC' })
      );

      const response = await agent.put('/api/mail-settings').send(validBody({ username: '' }));

      expect(response.status).toBe(200);
      const savedData = mockPrismaFunctions.mailSettings.upsert.mock.calls[0][0].update;
      expect(savedData.passwordEnc).toBe('');
    });

    test('an empty username wins over a provided password (wipe precedence)', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.mailSettings.findFirst.mockResolvedValue(
        settingsDoc({ id: 's1', username: 'relay-user', passwordEnc: 'EXISTING_ENC' })
      );

      const response = await agent
        .put('/api/mail-settings')
        .send(validBody({ username: '', password: 'ignored-because-no-username' }));

      expect(response.status).toBe(200);
      const savedData = mockPrismaFunctions.mailSettings.upsert.mock.calls[0][0].update;
      expect(savedData.passwordEnc).toBe('');
    });

    test('trims host/username/from/subjectTemplate before saving', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.mailSettings.findFirst.mockResolvedValue(settingsDoc({ id: 's1' }));

      await agent.put('/api/mail-settings').send(
        validBody({
          host: '  smtp.corp.example  ',
          username: '  relay-user  ',
          from: '  IdeaHub <no-reply@ideahub.local>  ',
          subjectTemplate: '  Hi {title}  ',
        })
      );

      const savedData = mockPrismaFunctions.mailSettings.upsert.mock.calls[0][0].update;
      expect(savedData.host).toBe('smtp.corp.example');
      expect(savedData.username).toBe('relay-user');
      expect(savedData.from).toBe('IdeaHub <no-reply@ideahub.local>');
      expect(savedData.subjectTemplate).toBe('Hi {title}');
    });

    test.each([
      ['a non-integer port', { port: 25.5 }],
      ['a port below 1', { port: 0 }],
      ['a port above 65535', { port: 70000 }],
      ['an over-long host', { host: 'a'.repeat(254) }],
      ['an unsupported language', { language: 'de' }],
      ['an empty from', { from: '   ' }],
    ])('rejects %s with 400 and does not write', async (_label, override) => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.mailSettings.findFirst.mockResolvedValue(null);

      const response = await agent.put('/api/mail-settings').send(validBody(override));

      expect(response.status).toBe(400);
      expect(mockPrismaFunctions.mailSettings.upsert).not.toHaveBeenCalled();
    });

    test('returns ONLY the first concise Zod issue message on a validation failure (house pattern, not the whole ZodError dump)', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockPrismaFunctions.mailSettings.findFirst.mockResolvedValue(null);

      const response = await agent.put('/api/mail-settings').send(validBody({ language: 'de' }));

      expect(response.status).toBe(400);
      // The single schema message — not a dumped ZodError issues array.
      expect(response.body.error).toBe('Language must be en or sk');
      expect(response.body.error).not.toContain('"code"');
      expect(response.body.error).not.toContain('[');
      expect(mockPrismaFunctions.mailSettings.upsert).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // POST /test: calls sendTestMail with the recipient and returns its structured
  // MailTestResult verbatim (always 200; the `status` field is the outcome).
  // -------------------------------------------------------------------------
  describe('POST /api/mail-settings/test', () => {
    test('calls sendTestMail with the recipient and returns its structured result (sent)', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockedSendTestMail.mockResolvedValue({ status: 'sent' });

      const response = await agent.post('/api/mail-settings/test').send({ to: 'admin@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'sent' });
      expect(mockedSendTestMail).toHaveBeenCalledTimes(1);
      // sendTestMail takes the plain recipient string (not a SendMailOptions object).
      expect(mockedSendTestMail.mock.calls[0][0]).toBe('admin@example.com');
    });

    test('passes a disabled result straight through as 200 { status: disabled }', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockedSendTestMail.mockResolvedValue({ status: 'disabled' });

      const response = await agent.post('/api/mail-settings/test').send({ to: 'admin@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'disabled' });
    });

    test('passes a failed result (fixed reason only) through as 200; body carries no ok/error text', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');
      mockedSendTestMail.mockResolvedValue({ status: 'failed', reason: 'auth_failed' });

      const response = await agent.post('/api/mail-settings/test').send({ to: 'admin@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'failed', reason: 'auth_failed' });
      // The route emits ONLY the structured result — no legacy `ok`, no free-form error.
      expect(response.body).not.toHaveProperty('ok');
      expect(response.body).not.toHaveProperty('error');
    });

    test('rejects an invalid recipient with 400 (concise message) and never sends', async () => {
      const { agent } = await loginAsUser(app, 'ADMIN');

      const response = await agent.post('/api/mail-settings/test').send({ to: 'not-an-email' });

      expect(response.status).toBe(400);
      // House pattern: the single concise issue message, not the whole ZodError.
      expect(response.body.error).toBe('Invalid email address');
      expect(response.body.error).not.toContain('"code"');
      expect(mockedSendTestMail).not.toHaveBeenCalled();
    });
  });
});
