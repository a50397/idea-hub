import request from 'supertest';
import express from 'express';
import session from 'express-session';
import cors from 'cors';

// Define mock Prisma BEFORE importing routes. GET /options -> getEffectiveMailConfig
// reads the singleton MailSettings via prisma.mailSettings.findUnique; the login
// helper (used to obtain a session) reads prisma.user.findUnique.
const mockPrismaFunctions: Record<string, any> = {
  user: {
    findUnique: jest.fn(),
  },
  mailSettings: {
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

// Import routes AFTER mocks. config/mail and config/sso are REAL (not mocked):
// mailEnabled derives from the (mocked) mailSettings document via the same
// getEffectiveMailConfig the mailer uses, and ssoShowLogout derives from the real
// SSO_SHOW_LOGOUT env read — exactly as in production.
import bcrypt from 'bcrypt';
import authRoutes from '../routes/auth';
import optionsRoutes from '../routes/options';

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
  });

  test('returns 401 when unauthenticated', async () => {
    const response = await request(app).get('/api/options');

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('error');
  });

  test('returns 200 with both flags (all false by default) for an authenticated regular user', async () => {
    const { agent } = await loginAsUser(app, 'USER');
    mockPrismaFunctions.mailSettings.findUnique.mockResolvedValue(null);

    const response = await agent.get('/api/options');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ mailEnabled: false, ssoShowLogout: false });
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

  test('ssoShowLogout is true only when SSO_SHOW_LOGOUT=true', async () => {
    process.env.SSO_SHOW_LOGOUT = 'true';
    const { agent } = await loginAsUser(app, 'USER');
    mockPrismaFunctions.mailSettings.findUnique.mockResolvedValue(null);

    const response = await agent.get('/api/options');

    expect(response.status).toBe(200);
    expect(response.body.ssoShowLogout).toBe(true);
  });

  test('responds with EXACTLY the two flag fields — no config or secret leak', async () => {
    process.env.SSO_SHOW_LOGOUT = 'true';
    const { agent } = await loginAsUser(app, 'USER');
    // A fully populated (secret-bearing) document must still yield only the two flags.
    mockPrismaFunctions.mailSettings.findUnique.mockResolvedValue(
      settingsDoc({
        enabled: true,
        host: 'smtp.corp.example',
        username: 'relay-user',
        passwordEnc: 'stored-ciphertext-value',
      })
    );

    const response = await agent.get('/api/options');

    expect(response.status).toBe(200);
    // Exactly the two documented flags — nothing more.
    expect(Object.keys(response.body).sort()).toEqual(['mailEnabled', 'ssoShowLogout']);
    expect(response.body).toEqual({ mailEnabled: true, ssoShowLogout: true });
    // No admin configuration, no public auth-config flag, and no secret material leaks.
    expect(response.body).not.toHaveProperty('host');
    expect(response.body).not.toHaveProperty('username');
    expect(response.body).not.toHaveProperty('passwordEnc');
    expect(response.body).not.toHaveProperty('ssoEnabled');
    expect(JSON.stringify(response.body)).not.toContain('stored-ciphertext-value');
  });
});
