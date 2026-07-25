// Requirement 1: local auth against the REAL app + a REAL connect-mongo session
// store. Proves the login session is actually persisted in Mongo, that /me
// round-trips it, and that logout destroys the stored session.
import {
  app,
  Role,
  newAgent,
  loginAs,
  withCsrf,
  waitForBoot,
  resetDb,
  createUser,
  getSessionDocs,
} from './support/helpers';
import request from 'supertest';

beforeAll(async () => {
  await waitForBoot();
});

beforeEach(async () => {
  await resetDb();
});

describe('local auth + connect-mongo session store (real DB)', () => {
  test('rejects login for an unknown email with 401', async () => {
    const res = await withCsrf(request(app).post('/api/auth/login')).send({
      email: 'nobody@example.com',
      password: 'whatever',
    });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error', 'Invalid email or password');
  });

  test('rejects login with a wrong password (real bcrypt compare) with 401', async () => {
    await createUser({ email: 'alice@example.com', password: 'correct-horse', role: Role.USER });
    const res = await withCsrf(request(app).post('/api/auth/login')).send({
      email: 'alice@example.com',
      password: 'wrong-password',
    });
    expect(res.status).toBe(401);
  });

  test('successful login persists a session document in the Mongo sessions collection', async () => {
    const user = await createUser({
      email: 'bob@example.com',
      password: 'hunter2secret',
      role: Role.POWER_USER,
      name: 'Bob',
    });

    // saveUninitialized=false: nothing stored yet for a brand-new visitor.
    expect(await getSessionDocs()).toHaveLength(0);

    const agent = newAgent();
    const res = await loginAs(agent, 'bob@example.com', 'hunter2secret');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: user.id, email: 'bob@example.com', role: 'POWER_USER' });
    expect(res.headers['set-cookie']).toBeDefined();

    const docs = await getSessionDocs(user.id);
    expect(docs).toHaveLength(1);
    // The store is configured with `stringify: false` (see index.ts), so `session`
    // is a nested object rather than a JSON string.
    const raw = (docs[0] as any).session;
    const stored = typeof raw === 'string' ? JSON.parse(raw) : raw;
    expect(stored.userId).toBe(user.id);
    expect(stored.role).toBe('POWER_USER');
  });

  test('/me round-trips the authenticated user via the persisted session', async () => {
    await createUser({
      email: 'carol@example.com',
      password: 'hunter2secret',
      role: Role.USER,
      name: 'Carol',
    });
    const agent = newAgent();
    await loginAs(agent, 'carol@example.com', 'hunter2secret');

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: 'carol@example.com', role: 'USER', name: 'Carol' });
    // /me selects authProvider; a local account has none.
    expect(me.body).toHaveProperty('authProvider', null);
  });

  test('logout destroys the persisted session (removed from Mongo, /me then 401)', async () => {
    const user = await createUser({ email: 'dave@example.com', password: 'hunter2secret' });
    const agent = newAgent();
    await loginAs(agent, 'dave@example.com', 'hunter2secret');

    expect(await getSessionDocs(user.id)).toHaveLength(1);

    const logout = await withCsrf(agent.post('/api/auth/logout'));
    expect(logout.status).toBe(200);
    expect(logout.body).toHaveProperty('message', 'Logged out successfully');

    expect(await getSessionDocs(user.id)).toHaveLength(0);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(401);
  });

  test('/me without a session returns 401 and writes no session document', async () => {
    const me = await request(app).get('/api/auth/me');
    expect(me.status).toBe(401);
    expect(await getSessionDocs()).toHaveLength(0);
  });
});
