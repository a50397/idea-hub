import request from 'supertest';
import express from 'express';
import session from 'express-session';
import crypto from 'crypto';
import http from 'http';

// ---------------------------------------------------------------------------
// Per-file Prisma mock factory (defined BEFORE the routes are required).
// The SSO route only uses user.{findUnique,findFirst,create,update}; Role is
// needed because middleware/auth.ts and routes/users.ts import it as a value.
// AuthProvider is intentionally NOT provided — the code uses the string 'SSO'.
// ---------------------------------------------------------------------------
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
  Role: {
    USER: 'USER',
    POWER_USER: 'POWER_USER',
    ADMIN: 'ADMIN',
  },
}));

jest.mock('bcrypt');

import bcrypt from 'bcrypt';
import { mapRolesToAppRole } from '../config/sso';

// oauth2-mock-server@9 is ESM-only (and pulls in ESM-only jose). Jest's CJS
// transpiler cannot load it, so we load it via Node's NATIVE dynamic import.
// Wrapping import() in `new Function` prevents ts-jest from downleveling it to
// require(). This needs NODE_OPTIONS=--experimental-vm-modules (set by the test
// script) so the dynamic-import callback is permitted inside jest's VM.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const nativeImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;

// ---------------------------------------------------------------------------
// Shared test state.
// ---------------------------------------------------------------------------
let mockServer: any;
let issuerUrl: string;
let app: express.Application;

// Claims injected into every token the mock IdP signs (access + id token).
// Reset per test; individual tests override to steer role/org/email/sub.
let injectedClaims: Record<string, unknown> = {};

const SESSION_SECRET = 'sso-test-session-secret-deterministic';
const CLIENT_ID = 'idea-hub-test-client';
const REDIRECT_URI = 'http://localhost:3001/api/auth/sso/callback';

const ENV_KEYS = [
  'SSO_ENABLED',
  'SSO_ISSUER_URL',
  'SSO_CLIENT_ID',
  'SSO_CLIENT_SECRET',
  'SSO_REDIRECT_URI',
  'SSO_SCOPE',
  'SSO_ROLES_CLAIM',
  'SSO_ORG_CLAIM',
  'SSO_EMAIL_CLAIM',
  'SSO_NAME_CLAIM',
  'SSO_ROLE_MAP',
  'BREAK_GLASS_EMAILS',
  'ADMIN_EMAIL',
  'SESSION_SECRET',
  'FRONTEND_URL',
  'COOKIE_SECURE',
];
const savedEnv: Record<string, string | undefined> = {};

const DEFAULT_ROLE_MAP = 'iam-admins:ADMIN,iam-power:POWER_USER,iam-users:USER';

function buildApp(): express.Application {
  // Require routes AFTER env + prisma mock are in place.
  const authRoutes = require('../routes/auth').default;
  const ssoRoutes = require('../routes/sso').default;
  const usersRoutes = require('../routes/users').default;

  const a = express();
  a.use(express.json());
  a.use(express.urlencoded({ extended: true }));
  a.use(
    session({
      secret: 'test-session-mw-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    })
  );
  a.use('/api/auth', authRoutes);
  a.use('/api/auth/sso', ssoRoutes);
  a.use('/api/users', usersRoutes);
  return a;
}

// Issue a raw GET to the mock IdP's /authorize URL WITHOUT following the
// redirect, and return the Location header (the app callback URL with code+state).
function httpGetLocation(urlStr: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = http.get(
      { hostname: u.hostname, port: u.port, path: `${u.pathname}${u.search}` },
      (res) => {
        res.resume(); // drain
        const loc = res.headers.location;
        if (!loc) {
          reject(new Error(`mock /authorize did not redirect (status ${res.statusCode})`));
          return;
        }
        resolve(loc);
      }
    );
    req.on('error', reject);
  });
}

// Drive /login -> mock /authorize and return the authorization code + state.
async function authorize(agent: any): Promise<{ code: string; state: string }> {
  const loginRes = await agent.get('/api/auth/sso/login');
  if (loginRes.status !== 302) {
    throw new Error(`/login expected 302, got ${loginRes.status}`);
  }
  const redirect = await httpGetLocation(loginRes.headers.location as string);
  const parsed = new URL(redirect);
  const code = parsed.searchParams.get('code');
  const state = parsed.searchParams.get('state');
  if (!code || !state) {
    throw new Error(`mock /authorize returned no code/state: ${redirect}`);
  }
  return { code, state };
}

// Sign a transaction cookie exactly like routes/sso.ts (used to craft
// tampered / expired cookies).
function craftTxnCookie(data: { state: string; nonce: string; cv: string; iat: number }): string {
  const payloadB64 = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', Buffer.from(SESSION_SECRET, 'utf8'))
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

  const mod = await nativeImport('oauth2-mock-server');
  const { OAuth2Server, Events } = mod;
  mockServer = new OAuth2Server();
  await mockServer.issuer.keys.generate('RS256');
  await mockServer.start(0, 'localhost');
  issuerUrl = mockServer.issuer.url;

  // Inject claims into both the access token and the id_token. A persistent
  // 'on' handler is required (not 'once') because each /token request signs two
  // tokens and we need our claims on the id_token as well.
  mockServer.service.on(Events.BeforeTokenSigning, (token: any) => {
    Object.assign(token.payload, injectedClaims);
  });

  process.env.SSO_ISSUER_URL = issuerUrl;
  process.env.SSO_CLIENT_ID = CLIENT_ID;
  process.env.SSO_CLIENT_SECRET = 'test-client-secret';
  process.env.SSO_REDIRECT_URI = REDIRECT_URI;
  process.env.SSO_SCOPE = 'openid profile email';
  process.env.SSO_ROLES_CLAIM = 'roles';
  process.env.SSO_ORG_CLAIM = 'org';
  process.env.SSO_EMAIL_CLAIM = 'email';
  process.env.SSO_NAME_CLAIM = 'name';
  process.env.SESSION_SECRET = SESSION_SECRET;
  process.env.FRONTEND_URL = 'http://localhost:5173';
  process.env.COOKIE_SECURE = 'false';
  process.env.SSO_ENABLED = 'true';
  process.env.SSO_ROLE_MAP = DEFAULT_ROLE_MAP;
  delete process.env.BREAK_GLASS_EMAILS;
  delete process.env.ADMIN_EMAIL;

  app = buildApp();
}, 30000);

afterAll(async () => {
  if (mockServer) await mockServer.stop();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  // Restore per-test env that individual tests may mutate.
  process.env.SSO_ENABLED = 'true';
  process.env.SSO_ROLE_MAP = DEFAULT_ROLE_MAP;
  delete process.env.BREAK_GLASS_EMAILS;
  delete process.env.ADMIN_EMAIL;
  // Baseline valid claim set.
  injectedClaims = {
    sub: 'sub-default',
    email: 'user@corp.example',
    name: 'Default User',
  };
});

// ===========================================================================
// 1. Config / enablement
// ===========================================================================
describe('SSO enablement', () => {
  test('GET /api/auth/config reports ssoEnabled:false when disabled', async () => {
    process.env.SSO_ENABLED = 'false';
    const res = await request(app).get('/api/auth/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ssoEnabled: false });
  });

  test('GET /api/auth/config reports ssoEnabled:true when enabled', async () => {
    process.env.SSO_ENABLED = 'true';
    const res = await request(app).get('/api/auth/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ssoEnabled: true });
  });

  test('GET /api/auth/sso/login returns 404 when disabled', async () => {
    process.env.SSO_ENABLED = 'false';
    const res = await request(app).get('/api/auth/sso/login');
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// 2. Authorization request
// ===========================================================================
describe('GET /api/auth/sso/login', () => {
  test('redirects to the issuer authorize endpoint with state + S256 challenge and sets sso_txn', async () => {
    const res = await request(app).get('/api/auth/sso/login');
    expect(res.status).toBe(302);

    const location = res.headers.location as string;
    expect(location.startsWith(`${issuerUrl}/authorize`)).toBe(true);
    const authUrl = new URL(location);
    expect(authUrl.searchParams.get('response_type')).toBe('code');
    expect(authUrl.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(authUrl.searchParams.get('state')).toBeTruthy();
    expect(authUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');

    const setCookie = res.headers['set-cookie'] as unknown as string[];
    const txn = setCookie.find((c) => c.startsWith('sso_txn='));
    expect(txn).toBeDefined();
    expect(txn).toMatch(/HttpOnly/i);
    expect(txn).toMatch(/Path=\/api\/auth\/sso/i);
    expect(txn).toMatch(/SameSite=Lax/i);
  });
});

// ===========================================================================
// 3. Happy path: JIT provisioning
// ===========================================================================
describe('GET /api/auth/sso/callback — JIT provisioning', () => {
  test('creates a new SSO user and establishes a session', async () => {
    injectedClaims = {
      sub: 'sub-newbie',
      email: 'newbie@corp.example',
      name: 'New Bie',
      roles: ['iam-users'],
      org: 'Platform',
    };
    const created = {
      id: 'created-1',
      name: 'New Bie',
      email: 'newbie@corp.example',
      role: 'USER',
      authProvider: 'SSO',
      department: 'Platform',
      createdAt: new Date(),
    };
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockImplementation((args: any) =>
      args?.where?.email !== undefined ? Promise.resolve(null) : Promise.resolve(created)
    );
    mockPrisma.user.create.mockResolvedValue(created);

    const agent = request.agent(app);
    const { code, state } = await authorize(agent);
    const cbRes = await agent.get(`/api/auth/sso/callback?code=${code}&state=${state}`);

    expect(cbRes.status).toBe(302);
    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'newbie@corp.example',
          name: 'New Bie',
          ssoSub: 'sub-newbie',
          authProvider: 'SSO',
          role: 'USER',
          department: 'Platform',
        }),
      })
    );

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toHaveProperty('email', 'newbie@corp.example');
  });
});

// ===========================================================================
// 4. Link-by-email
// ===========================================================================
describe('GET /api/auth/sso/callback — link by email', () => {
  test('links an existing local account: sets ssoSub, authProvider SSO, clears password', async () => {
    injectedClaims = {
      sub: 'sub-alice',
      email: 'alice@corp.example',
      name: 'Alice From IdP',
      roles: ['iam-power'],
    };
    const localUser = {
      id: 'local-alice',
      name: 'Alice Local',
      email: 'alice@corp.example',
      role: 'USER',
      authProvider: null,
      passwordHash: '$2b$10$existinghash',
    };
    const updated = { ...localUser, name: 'Alice From IdP', role: 'POWER_USER', authProvider: 'SSO' };

    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockImplementation((args: any) =>
      args?.where?.email !== undefined ? Promise.resolve(localUser) : Promise.resolve(updated)
    );
    mockPrisma.user.update.mockResolvedValue(updated);

    const agent = request.agent(app);
    const { code, state } = await authorize(agent);
    const cbRes = await agent.get(`/api/auth/sso/callback?code=${code}&state=${state}`);

    expect(cbRes.status).toBe(302);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'local-alice' },
        data: expect.objectContaining({
          ssoSub: 'sub-alice',
          authProvider: 'SSO',
          passwordHash: null,
        }),
      })
    );
  });

  test('returning SSO user (found by ssoSub) is updated, not created', async () => {
    injectedClaims = { sub: 'sub-return', email: 'ret@corp.example', name: 'Returner', roles: ['iam-admins'] };
    const existing = {
      id: 'user-ret',
      name: 'Returner',
      email: 'ret@corp.example',
      role: 'ADMIN',
      authProvider: 'SSO',
      ssoSub: 'sub-return',
    };
    mockPrisma.user.findFirst.mockResolvedValue(existing);
    mockPrisma.user.update.mockResolvedValue(existing);

    const agent = request.agent(app);
    const { code, state } = await authorize(agent);
    const cbRes = await agent.get(`/api/auth/sso/callback?code=${code}&state=${state}`);

    expect(cbRes.status).toBe(302);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'ret@corp.example' } })
    );
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-ret' } })
    );
  });
});

// ===========================================================================
// 5. Role mapping (via claim injection) + unit checks
// ===========================================================================
describe('SSO role mapping', () => {
  async function provisionWithRoles(roles: unknown): Promise<any> {
    injectedClaims = { sub: `sub-${Math.random()}`, email: 'roletest@corp.example', name: 'Role Test', roles };
    const created = {
      id: 'role-user',
      name: 'Role Test',
      email: 'roletest@corp.example',
      role: 'USER',
      authProvider: 'SSO',
      department: null,
      createdAt: new Date(),
    };
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockImplementation((args: any) =>
      args?.where?.email !== undefined ? Promise.resolve(null) : Promise.resolve(created)
    );
    mockPrisma.user.create.mockResolvedValue(created);

    const agent = request.agent(app);
    const { code, state } = await authorize(agent);
    const cbRes = await agent.get(`/api/auth/sso/callback?code=${code}&state=${state}`);
    expect(cbRes.status).toBe(302);
    return mockPrisma.user.create.mock.calls[0][0].data;
  }

  test('single mapped role', async () => {
    const data = await provisionWithRoles(['iam-power']);
    expect(data.role).toBe('POWER_USER');
  });

  test('multiple roles -> highest privilege wins', async () => {
    const data = await provisionWithRoles(['iam-users', 'iam-admins', 'iam-power']);
    expect(data.role).toBe('ADMIN');
  });

  test('unmapped role -> USER', async () => {
    const data = await provisionWithRoles(['iam-nobody']);
    expect(data.role).toBe('USER');
  });

  test('mapRolesToAppRole unit: string / array / undefined / highest-wins', () => {
    process.env.SSO_ROLE_MAP = DEFAULT_ROLE_MAP;
    expect(mapRolesToAppRole('iam-admins')).toBe('ADMIN');
    expect(mapRolesToAppRole('iam-power iam-users')).toBe('POWER_USER');
    expect(mapRolesToAppRole('iam-users,iam-admins')).toBe('ADMIN');
    expect(mapRolesToAppRole(['iam-users'])).toBe('USER');
    expect(mapRolesToAppRole('IAM-ADMINS')).toBe('ADMIN'); // case-insensitive keys
    expect(mapRolesToAppRole(undefined)).toBe('USER');
    expect(mapRolesToAppRole('totally-unknown')).toBe('USER');
  });
});

// ===========================================================================
// 6. Department from org claim
// ===========================================================================
describe('SSO department mapping', () => {
  async function provisionWithOrg(org: unknown): Promise<any> {
    injectedClaims = { sub: `sub-${Math.random()}`, email: 'dept@corp.example', name: 'Dept Test' };
    if (org !== undefined) (injectedClaims as any).org = org;
    const created = {
      id: 'dept-user',
      name: 'Dept Test',
      email: 'dept@corp.example',
      role: 'USER',
      authProvider: 'SSO',
      department: null,
      createdAt: new Date(),
    };
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockImplementation((args: any) =>
      args?.where?.email !== undefined ? Promise.resolve(null) : Promise.resolve(created)
    );
    mockPrisma.user.create.mockResolvedValue(created);

    const agent = request.agent(app);
    const { code, state } = await authorize(agent);
    const cbRes = await agent.get(`/api/auth/sso/callback?code=${code}&state=${state}`);
    expect(cbRes.status).toBe(302);
    return mockPrisma.user.create.mock.calls[0][0].data;
  }

  test('captures department from org claim', async () => {
    const data = await provisionWithOrg('Engineering');
    expect(data.department).toBe('Engineering');
  });

  test('missing org claim -> department null', async () => {
    const data = await provisionWithOrg(undefined);
    expect(data.department).toBeNull();
  });
});

// ===========================================================================
// 7-9. Failure paths (state / txn cookie / IdP error)
// ===========================================================================
describe('GET /api/auth/sso/callback — failures redirect without a session', () => {
  test('state mismatch -> error redirect, no session', async () => {
    const agent = request.agent(app);
    const { code, state } = await authorize(agent);
    const cbRes = await agent.get(`/api/auth/sso/callback?code=${code}&state=${state}tampered`);

    expect(cbRes.status).toBe(302);
    expect(cbRes.headers.location).toContain('error=sso_failed');
    expect(mockPrisma.user.create).not.toHaveBeenCalled();

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(401);
  });

  test('missing txn cookie -> error redirect', async () => {
    const res = await request(app).get('/api/auth/sso/callback?code=abc&state=xyz');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('error=sso_failed');
  });

  test('tampered txn signature -> error redirect', async () => {
    const valid = craftTxnCookie({ state: 's', nonce: 'n', cv: 'a'.repeat(43), iat: Date.now() });
    const tampered = `${valid.split('.')[0]}.deadbeefdeadbeef`;
    const res = await request(app)
      .get('/api/auth/sso/callback?code=abc&state=s')
      .set('Cookie', `sso_txn=${tampered}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('error=sso_failed');
  });

  test('expired txn (iat older than 10 minutes) -> error redirect', async () => {
    const expired = craftTxnCookie({
      state: 's',
      nonce: 'n',
      cv: 'a'.repeat(43),
      iat: Date.now() - 11 * 60 * 1000,
    });
    const res = await request(app)
      .get('/api/auth/sso/callback?code=abc&state=s')
      .set('Cookie', `sso_txn=${expired}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('error=sso_failed');
  });

  test('IdP error param -> error redirect, no session', async () => {
    const agent = request.agent(app);
    await authorize(agent); // obtain a valid txn cookie
    const cbRes = await agent.get('/api/auth/sso/callback?error=access_denied&state=whatever');

    expect(cbRes.status).toBe(302);
    expect(cbRes.headers.location).toContain('error=sso_failed');
    expect(mockPrisma.user.create).not.toHaveBeenCalled();

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(401);
  });
});

// ===========================================================================
// 10. Break-glass email may never authenticate via SSO
// ===========================================================================
describe('SSO break-glass protection', () => {
  test('break-glass email -> error redirect, no user provisioned', async () => {
    process.env.BREAK_GLASS_EMAILS = 'root@corp.example';
    injectedClaims = { sub: 'sub-bg', email: 'root@corp.example', name: 'Root' };
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const agent = request.agent(app);
    const { code, state } = await authorize(agent);
    const cbRes = await agent.get(`/api/auth/sso/callback?code=${code}&state=${state}`);

    expect(cbRes.status).toBe(302);
    expect(cbRes.headers.location).toContain('error=sso_failed');
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(401);
  });
});

// ===========================================================================
// 11. Local login rejected for SSO (null passwordHash) accounts
// ===========================================================================
describe('POST /api/auth/login — SSO accounts', () => {
  test('null passwordHash -> generic 401', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'sso-login',
      name: 'SSO User',
      email: 'sso@corp.example',
      role: 'USER',
      authProvider: 'SSO',
      passwordHash: null,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sso@corp.example', password: 'anything' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error', 'Invalid email or password');
    // F11: the no-passwordHash path runs a dummy bcrypt.compare to equalize login
    // timing (so SSO-only accounts cannot be distinguished by response time). The
    // response is still a generic 401; the comparison is against a constant hash.
    expect(bcrypt.compare).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 12. change-password blocked for SSO session user
// ===========================================================================
describe('POST /api/auth/change-password — SSO accounts', () => {
  test('SSO session user -> 403', async () => {
    injectedClaims = { sub: 'sub-cp', email: 'cp@corp.example', name: 'CP' };
    const ssoUser = {
      id: 'sso-cp',
      name: 'CP',
      email: 'cp@corp.example',
      role: 'USER',
      authProvider: 'SSO',
      department: null,
      passwordHash: null,
      createdAt: new Date(),
    };
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockImplementation((args: any) =>
      args?.where?.email !== undefined ? Promise.resolve(null) : Promise.resolve(ssoUser)
    );
    mockPrisma.user.create.mockResolvedValue(ssoUser);

    const agent = request.agent(app);
    const { code, state } = await authorize(agent);
    const cbRes = await agent.get(`/api/auth/sso/callback?code=${code}&state=${state}`);
    expect(cbRes.status).toBe(302);

    const res = await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: 'irrelevant', newPassword: 'newpassword123' });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error', 'Password change is not available for SSO accounts');
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 13. Admin may not edit SSO-managed users
// ===========================================================================
describe('PATCH /api/users/:id — SSO-managed users', () => {
  test('changing role of an SSO user -> 400', async () => {
    const adminUser = {
      id: 'admin-1',
      name: 'Admin',
      email: 'admin@corp.example',
      role: 'ADMIN',
      passwordHash: '$2b$10$adminhash',
    };
    const targetSso = {
      id: 'bbbbbbbbbbbbbbbbbbbbb999',
      name: 'SSO Target',
      email: 'target@corp.example',
      role: 'USER',
      authProvider: 'SSO',
    };
    mockPrisma.user.findUnique.mockImplementation((args: any) =>
      args?.where?.email !== undefined ? Promise.resolve(adminUser) : Promise.resolve(targetSso)
    );
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'admin@corp.example', password: 'pw' });

    const res = await agent
      .patch('/api/users/bbbbbbbbbbbbbbbbbbbbb999')
      .send({ role: 'ADMIN' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'User is managed by SSO');
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 14. RP-initiated logout (OIDC end-session)
// ===========================================================================
describe('POST /api/auth/logout — RP-initiated (SSO) logout', () => {
  test('SSO login stores the id_token; logout returns an IdP end-session redirectTo and destroys the session', async () => {
    injectedClaims = {
      sub: 'sub-logout',
      email: 'logout@corp.example',
      name: 'Logout User',
      roles: ['iam-users'],
    };
    const created = {
      id: 'logout-1',
      name: 'Logout User',
      email: 'logout@corp.example',
      role: 'USER',
      authProvider: 'SSO',
      department: null,
      createdAt: new Date(),
    };
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockImplementation((args: any) =>
      args?.where?.email !== undefined ? Promise.resolve(null) : Promise.resolve(created)
    );
    mockPrisma.user.create.mockResolvedValue(created);

    const agent = request.agent(app);
    const { code, state } = await authorize(agent);
    const cbRes = await agent.get(`/api/auth/sso/callback?code=${code}&state=${state}`);
    expect(cbRes.status).toBe(302);

    // Session is live before logout (proves the callback established it).
    const meBefore = await agent.get('/api/auth/me');
    expect(meBefore.status).toBe(200);

    const logoutRes = await agent.post('/api/auth/logout');
    expect(logoutRes.status).toBe(200);
    // Message is unchanged; redirectTo is ADDED for SSO sessions.
    expect(logoutRes.body).toHaveProperty('message', 'Logged out successfully');
    expect(logoutRes.body).toHaveProperty('redirectTo');

    const redirectTo = logoutRes.body.redirectTo as string;
    // Targets the discovered end_session_endpoint...
    expect(redirectTo).toContain(`${issuerUrl}/endsession`);
    // ...carrying the id_token_hint (only stored server-side, only leaves here)
    // and the post_logout_redirect_uri (defaults to ${FRONTEND_URL}/login).
    const u = new URL(redirectTo);
    expect(u.searchParams.get('id_token_hint')).toBeTruthy();
    expect(u.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost:5173/login');

    // The local session is actually destroyed.
    const meAfter = await agent.get('/api/auth/me');
    expect(meAfter.status).toBe(401);
  });
});
