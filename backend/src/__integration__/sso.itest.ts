// Requirement 6: SSO/OIDC upsert paths against the REAL DB, driven by an
// in-process oauth2-mock-server (mirrors src/__tests__/sso.test.ts, but nothing
// is mocked here — every write/read hits Prisma + Mongo).
//
// Covers: JIT provisioning, link-by-email (LOCAL -> SSO conversion), re-sync of
// role/name/department on a returning subject, and two distinct subjects
// coexisting (ssoSub is intentionally non-unique).
import http from 'http';
import { prisma, newAgent, waitForBoot, resetDb, createUser, AuthProvider, Role } from './support/helpers';

// oauth2-mock-server@9 is ESM-only; load it via Node's native dynamic import
// (needs NODE_OPTIONS=--experimental-vm-modules, set by the test:integration script).
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const nativeImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;

let mockServer: any;
let issuerUrl: string;
let injectedClaims: Record<string, unknown> = {};

const CLIENT_ID = 'idea-hub-itest-client';
const REDIRECT_URI = 'http://localhost:3001/api/auth/sso/callback';
const ROLE_MAP = 'iam-admins:ADMIN,iam-power:POWER_USER,iam-users:USER';

const SSO_ENV_KEYS = [
  'SSO_ENABLED', 'SSO_ISSUER_URL', 'SSO_CLIENT_ID', 'SSO_CLIENT_SECRET', 'SSO_REDIRECT_URI',
  'SSO_SCOPE', 'SSO_ROLES_CLAIM', 'SSO_ORG_CLAIM', 'SSO_EMAIL_CLAIM', 'SSO_NAME_CLAIM',
  'SSO_ROLE_MAP', 'BREAK_GLASS_EMAILS',
];
const savedEnv: Record<string, string | undefined> = {};

// GET the mock IdP's /authorize URL WITHOUT following the redirect; return Location.
function httpGetLocation(urlStr: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = http.get({ hostname: u.hostname, port: u.port, path: `${u.pathname}${u.search}` }, (res) => {
      res.resume();
      const loc = res.headers.location;
      if (!loc) return reject(new Error(`mock /authorize did not redirect (status ${res.statusCode})`));
      resolve(loc);
    });
    req.on('error', reject);
  });
}

// Drive /login -> mock /authorize and return the authorization code + state.
async function authorize(agent: ReturnType<typeof newAgent>): Promise<{ code: string; state: string }> {
  const loginRes = await agent.get('/api/auth/sso/login');
  if (loginRes.status !== 302) throw new Error(`/login expected 302, got ${loginRes.status}`);
  const redirect = await httpGetLocation(loginRes.headers.location as string);
  const parsed = new URL(redirect);
  const code = parsed.searchParams.get('code');
  const state = parsed.searchParams.get('state');
  if (!code || !state) throw new Error(`mock /authorize returned no code/state: ${redirect}`);
  return { code, state };
}

async function ssoLogin(agent: ReturnType<typeof newAgent>, claims: Record<string, unknown>) {
  injectedClaims = claims;
  const { code, state } = await authorize(agent);
  return agent.get(`/api/auth/sso/callback?code=${code}&state=${state}`);
}

beforeAll(async () => {
  await waitForBoot();

  for (const k of SSO_ENV_KEYS) savedEnv[k] = process.env[k];

  const { OAuth2Server, Events } = await nativeImport('oauth2-mock-server');
  mockServer = new OAuth2Server();
  await mockServer.issuer.keys.generate('RS256');
  await mockServer.start(0, 'localhost');
  issuerUrl = mockServer.issuer.url;
  mockServer.service.on(Events.BeforeTokenSigning, (token: any) => {
    Object.assign(token.payload, injectedClaims);
  });

  process.env.SSO_ENABLED = 'true';
  process.env.SSO_ISSUER_URL = issuerUrl;
  process.env.SSO_CLIENT_ID = CLIENT_ID;
  process.env.SSO_CLIENT_SECRET = 'itest-client-secret';
  process.env.SSO_REDIRECT_URI = REDIRECT_URI;
  process.env.SSO_SCOPE = 'openid profile email';
  process.env.SSO_ROLES_CLAIM = 'roles';
  process.env.SSO_ORG_CLAIM = 'org';
  process.env.SSO_EMAIL_CLAIM = 'email';
  process.env.SSO_NAME_CLAIM = 'name';
  process.env.SSO_ROLE_MAP = ROLE_MAP;
  delete process.env.BREAK_GLASS_EMAILS;
}, 30000);

afterAll(async () => {
  if (mockServer) await mockServer.stop();
  for (const k of SSO_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

beforeEach(async () => {
  await resetDb();
  injectedClaims = {};
});

describe('SSO provisioning against the real DB', () => {
  test('JIT-creates a real SSO user (ssoSub, authProvider SSO, department from org)', async () => {
    const agent = newAgent();
    const cb = await ssoLogin(agent, {
      sub: 'sub-jit',
      email: 'jit@corp.example',
      name: 'Jit User',
      roles: ['iam-users'],
      org: 'Platform',
    });
    expect(cb.status).toBe(302);

    const user = await prisma.user.findFirst({ where: { ssoSub: 'sub-jit' } });
    expect(user).not.toBeNull();
    expect(user).toMatchObject({
      email: 'jit@corp.example',
      name: 'Jit User',
      role: Role.USER,
      authProvider: AuthProvider.SSO,
      department: 'Platform',
    });
    expect(user!.passwordHash).toBeNull();

    // Session works end-to-end.
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: 'jit@corp.example', authProvider: 'SSO', department: 'Platform' });
  });

  test('JIT provisioning with no org claim leaves department null', async () => {
    const agent = newAgent();
    const cb = await ssoLogin(agent, { sub: 'sub-noorg', email: 'noorg@corp.example', name: 'No Org' });
    expect(cb.status).toBe(302);
    const user = await prisma.user.findFirst({ where: { ssoSub: 'sub-noorg' } });
    expect(user!.department).toBeNull();
    expect(user!.role).toBe(Role.USER); // unmapped roles -> USER
  });

  test('links an existing LOCAL account by email (clears password, sets ssoSub + SSO)', async () => {
    const local = await createUser({
      email: 'link@corp.example',
      name: 'Local Name',
      password: 'localsecret',
      role: Role.USER,
      authProvider: AuthProvider.LOCAL,
    });

    const agent = newAgent();
    const cb = await ssoLogin(agent, {
      sub: 'sub-link',
      email: 'link@corp.example',
      name: 'Linked From IdP',
      roles: ['iam-power'],
    });
    expect(cb.status).toBe(302);

    // Same document, now SSO-managed — not a duplicate.
    expect(await prisma.user.count({ where: { email: 'link@corp.example' } })).toBe(1);
    const updated = await prisma.user.findUnique({ where: { id: local.id } });
    expect(updated).toMatchObject({
      ssoSub: 'sub-link',
      authProvider: AuthProvider.SSO,
      role: Role.POWER_USER,
      name: 'Linked From IdP',
    });
    expect(updated!.passwordHash).toBeNull();
  });

  test('a returning subject re-syncs role, name and department in place', async () => {
    const agent1 = newAgent();
    await ssoLogin(agent1, { sub: 'sub-sync', email: 'sync@corp.example', name: 'Name One', roles: ['iam-users'], org: 'Dept One' });
    const first = await prisma.user.findFirst({ where: { ssoSub: 'sub-sync' } });
    expect(first).toMatchObject({ role: Role.USER, name: 'Name One', department: 'Dept One' });

    const agent2 = newAgent();
    const cb = await ssoLogin(agent2, { sub: 'sub-sync', email: 'sync@corp.example', name: 'Name Two', roles: ['iam-admins'], org: 'Dept Two' });
    expect(cb.status).toBe(302);

    expect(await prisma.user.count({ where: { ssoSub: 'sub-sync' } })).toBe(1);
    const resynced = await prisma.user.findFirst({ where: { ssoSub: 'sub-sync' } });
    expect(resynced).toMatchObject({ id: first!.id, role: Role.ADMIN, name: 'Name Two', department: 'Dept Two' });
  });

  test('two distinct subjects with different emails coexist (ssoSub is non-unique)', async () => {
    await ssoLogin(newAgent(), { sub: 'sub-a', email: 'a@corp.example', name: 'Alpha', roles: ['iam-users'] });
    await ssoLogin(newAgent(), { sub: 'sub-b', email: 'b@corp.example', name: 'Beta', roles: ['iam-power'] });

    const ssoUsers = await prisma.user.findMany({ where: { authProvider: AuthProvider.SSO }, orderBy: { ssoSub: 'asc' } });
    expect(ssoUsers).toHaveLength(2);
    expect(ssoUsers.map((u) => u.ssoSub)).toEqual(['sub-a', 'sub-b']);
    expect(ssoUsers.map((u) => u.role)).toEqual([Role.USER, Role.POWER_USER]);
  });
});
