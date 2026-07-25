// Requirement 2: the REAL unique index on users.email (created by
// `prisma db push`). Proves the API surfaces a clean 4xx on duplicates and that
// the underlying index actually rejects a direct duplicate write with P2002.
import {
  Role,
  prisma,
  newAgent,
  loginAs,
  withCsrf,
  waitForBoot,
  resetDb,
  createUser,
  listIndexes,
} from './support/helpers';

beforeAll(async () => {
  await waitForBoot();
});

beforeEach(async () => {
  await resetDb();
});

async function loggedInAdmin() {
  await createUser({ email: 'admin@users.test', password: 'adminsecret', role: Role.ADMIN });
  const agent = newAgent();
  const res = await loginAs(agent, 'admin@users.test', 'adminsecret');
  expect(res.status).toBe(200);
  return agent;
}

describe('users.email unique index (real DB)', () => {
  test('the users collection has a unique index on email', async () => {
    const indexes = await listIndexes('users');
    const emailIndex = indexes.find((i) => i.key && i.key.email === 1);
    expect(emailIndex).toBeDefined();
    expect(emailIndex.unique).toBe(true);
  });

  test('POST /api/users with a duplicate email returns a clean 400 (never 500)', async () => {
    const agent = await loggedInAdmin();

    const first = await withCsrf(agent.post('/api/users')).send({
      name: 'First Person',
      email: 'dup@example.com',
      password: 'password1234',
      role: 'USER',
    });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ email: 'dup@example.com', role: 'USER' });
    expect(first.body.passwordHash).toBeUndefined();

    const second = await withCsrf(agent.post('/api/users')).send({
      name: 'Second Person',
      email: 'dup@example.com',
      password: 'password1234',
      role: 'USER',
    });
    expect(second.status).toBe(400);
    expect(second.status).not.toBe(500);
    expect(second.body).toHaveProperty('error', 'Email already exists');

    // Exactly one such user actually persisted.
    expect(await prisma.user.count({ where: { email: 'dup@example.com' } })).toBe(1);
  });

  test('POST /api/users persists a bcrypt-hashed password', async () => {
    const agent = await loggedInAdmin();
    await withCsrf(agent.post('/api/users')).send({
      name: 'Hashed User',
      email: 'hashed@example.com',
      password: 'password1234',
      role: 'USER',
    });
    const created = await prisma.user.findUnique({ where: { email: 'hashed@example.com' } });
    expect(created).not.toBeNull();
    expect(created!.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  test('a direct duplicate insert is rejected by the index with Prisma P2002', async () => {
    await createUser({ email: 'race@example.com', password: null });
    await expect(
      prisma.user.create({
        data: { name: 'Racer', email: 'race@example.com', role: Role.USER },
      })
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
