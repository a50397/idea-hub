// Requirement 7: PATCH /api/users/:id role/email change must invalidate the
// target user's persisted session so a privilege change takes effect immediately.
//
// The fix (routes/users.ts + index.ts) has two parts, BOTH required — against
// connect-mongo v6 the previous code was a no-op for two independent reasons:
//   1. It read `req.sessionStore.collection`, but v6 exposes the collection as
//      `collectionP` (a Promise); the old guard was always false. Fixed by
//      awaiting `sessionStore.collectionP`.
//   2. The store stringified `session` to JSON, so `deleteMany({'session.userId'})`
//      matched nothing. Fixed by configuring the store with `stringify: false`.
//
// These tests prove the real store + code path, that logout destroys sessions,
// and (regression test) that a role change now invalidates the target session.
import {
  Role,
  prisma,
  newAgent,
  loginAs,
  withCsrf,
  waitForBoot,
  resetDb,
  createUser,
  getSessionDocs,
} from './support/helpers';

beforeAll(async () => {
  await waitForBoot();
});

beforeEach(async () => {
  await resetDb();
});

async function seedTargetAndAdmin() {
  const target = await createUser({ email: 'target@inv.test', password: 'pw', role: Role.USER });
  await createUser({ email: 'admin@inv.test', password: 'pw', role: Role.ADMIN });

  const targetAgent = newAgent();
  expect((await loginAs(targetAgent, 'target@inv.test', 'pw')).status).toBe(200);
  const adminAgent = newAgent();
  expect((await loginAs(adminAgent, 'admin@inv.test', 'pw')).status).toBe(200);

  return { target, targetAgent, adminAgent };
}

describe('PATCH /api/users/:id role change vs. the real session store', () => {
  test('the change persists and the target had a real persisted session (store + code path are real)', async () => {
    const { target, targetAgent, adminAgent } = await seedTargetAndAdmin();

    // The target's login really is persisted in Mongo.
    expect(await getSessionDocs(target.id)).toHaveLength(1);
    expect((await targetAgent.get('/api/auth/me')).status).toBe(200);

    const res = await withCsrf(adminAgent.patch(`/api/users/${target.id}`)).send({ role: 'POWER_USER' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('POWER_USER');
    expect((await prisma.user.findUnique({ where: { id: target.id } }))!.role).toBe('POWER_USER');
  });

  test('logout DOES destroy the persisted session via the real store (correct code path)', async () => {
    const target = await createUser({ email: 'logout@inv.test', password: 'pw', role: Role.USER });
    const agent = newAgent();
    await loginAs(agent, 'logout@inv.test', 'pw');
    expect(await getSessionDocs(target.id)).toHaveLength(1);

    const logout = await withCsrf(agent.post('/api/auth/logout'));
    expect(logout.status).toBe(200);
    expect(await getSessionDocs(target.id)).toHaveLength(0);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  // Regression test for requirement 7 — previously skipped until the fix landed.
  // With `collectionP` awaited and `stringify: false`, the invalidation now runs
  // and matches, so the target's session is deleted and the next request is 401.
  test('role change invalidates the target session so the next request is 401', async () => {
    const { target, targetAgent, adminAgent } = await seedTargetAndAdmin();

    const res = await withCsrf(adminAgent.patch(`/api/users/${target.id}`)).send({ role: 'POWER_USER' });
    expect(res.status).toBe(200);

    expect(await getSessionDocs(target.id)).toHaveLength(0);
    expect((await targetAgent.get('/api/auth/me')).status).toBe(401);
  });

  // Invalidation triggers on `data.role || data.email`, so an admin email change
  // must invalidate the target's session too (distinct from the role-change path).
  test('email change invalidates the target session so the next request is 401', async () => {
    const { target, targetAgent, adminAgent } = await seedTargetAndAdmin();

    const res = await withCsrf(adminAgent.patch(`/api/users/${target.id}`)).send({
      email: 'target-moved@inv.test',
    });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('target-moved@inv.test');

    expect(await getSessionDocs(target.id)).toHaveLength(0);
    expect((await targetAgent.get('/api/auth/me')).status).toBe(401);
  });
});
