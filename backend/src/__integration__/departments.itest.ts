// Feature 2: departments against the real DB — the unique name index (created by
// `prisma db push`), the boot/ensureDepartments idempotency + legacy backfill, and
// the delete/reorder guards that only make sense with real persistence.
import {
  Role,
  Effort,
  prisma,
  newAgent,
  loginAs,
  withCsrf,
  waitForBoot,
  resetDb,
  createUser,
  createIdea,
  listIndexes,
  ensureDepartments,
  getDefaultDepartmentId,
} from './support/helpers';

beforeAll(async () => {
  await waitForBoot();
});

beforeEach(async () => {
  await resetDb();
});

async function loggedInAdmin() {
  await createUser({ email: 'admin@dep.test', password: 'adminsecret', role: Role.ADMIN });
  const agent = newAgent();
  const res = await loginAs(agent, 'admin@dep.test', 'adminsecret');
  expect(res.status).toBe(200);
  return agent;
}

describe('departments (real DB)', () => {
  test('the departments collection has a unique index on name', async () => {
    const indexes = await listIndexes('departments');
    const nameIndex = indexes.find((i) => i.key && i.key.name === 1);
    expect(nameIndex).toBeDefined();
    expect(nameIndex.unique).toBe(true);
  });

  test('POST /api/departments with a duplicate name returns a clean 409 (never 500)', async () => {
    const admin = await loggedInAdmin();

    const first = await withCsrf(admin.post('/api/departments')).send({ name: 'Marketing' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ name: 'Marketing' });

    const second = await withCsrf(admin.post('/api/departments')).send({ name: 'Marketing' });
    expect(second.status).toBe(409);
    expect(second.status).not.toBe(500);
    expect(await prisma.department.count({ where: { name: 'Marketing' } })).toBe(1);
  });

  test('a direct duplicate insert is rejected by the index with Prisma P2002', async () => {
    await prisma.department.create({ data: { name: 'Ops', order: 9 } });
    await expect(
      prisma.department.create({ data: { name: 'Ops', order: 10 } })
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  test('ensureDepartments is idempotent: invoking twice yields exactly one default', async () => {
    await prisma.department.deleteMany({});

    await ensureDepartments();
    await ensureDepartments();

    const departments = await prisma.department.findMany();
    expect(departments).toHaveLength(1);
    expect(departments[0]).toMatchObject({ name: 'Všeobecné', order: 0 });
  });

  test('ensureDepartments backfills a legacy idea that has a null departmentId', async () => {
    const user = await createUser({ email: 'legacy@dep.test', password: null });

    // A legacy Mongo document shape: an idea created directly with no department.
    const legacy = await prisma.idea.create({
      data: {
        title: 'Legacy idea title',
        description: 'A legacy idea with no department set.',
        benefits: 'It predates the departments feature.',
        effort: Effort.LESS_THAN_ONE_DAY,
        submitterId: user.id,
      },
    });
    expect(legacy.departmentId).toBeNull();

    await ensureDepartments();

    const first = await prisma.department.findFirst({ orderBy: [{ order: 'asc' }, { name: 'asc' }] });
    const after = await prisma.idea.findUnique({ where: { id: legacy.id } });
    expect(after!.departmentId).toBe(first!.id);
  });

  test('DELETE is blocked (409) while the department is still referenced by an idea', async () => {
    const admin = await loggedInAdmin();
    const user = await createUser({ email: 'ref@dep.test', password: null });

    const dept = await prisma.department.create({ data: { name: 'Referenced', order: 5 } });
    await createIdea({ submitterId: user.id, departmentId: dept.id });

    const res = await withCsrf(admin.delete(`/api/departments/${dept.id}`));
    expect(res.status).toBe(409);
    // Still present.
    expect(await prisma.department.count({ where: { id: dept.id } })).toBe(1);
  });

  test('DELETE is blocked (409) when it is the last remaining department', async () => {
    const admin = await loggedInAdmin();
    const only = await getDefaultDepartmentId();

    const res = await withCsrf(admin.delete(`/api/departments/${only}`));
    expect(res.status).toBe(409);
    expect(await prisma.department.count()).toBe(1);
  });

  test('DELETE succeeds for an unreferenced, non-last department', async () => {
    const admin = await loggedInAdmin();
    const dept = await prisma.department.create({ data: { name: 'Disposable', order: 7 } });

    const res = await withCsrf(admin.delete(`/api/departments/${dept.id}`));
    expect(res.status).toBe(200);
    expect(await prisma.department.count({ where: { id: dept.id } })).toBe(0);
  });

  test('PATCH /reorder persists a new order and changes the GET sort order', async () => {
    const admin = await loggedInAdmin();

    // Default (Všeobecné, order 0) + two more.
    await prisma.department.create({ data: { name: 'Marketing', order: 1 } });
    await prisma.department.create({ data: { name: 'Sales', order: 2 } });

    const before = await admin.get('/api/departments');
    expect(before.status).toBe(200);
    expect(before.body.map((d: { name: string }) => d.name)).toEqual(['Všeobecné', 'Marketing', 'Sales']);
    const ids = before.body.map((d: { id: string }) => d.id);

    // Reverse the order via an exact permutation of all ids.
    const res = await withCsrf(admin.patch('/api/departments/reorder')).send({
      ids: [ids[2], ids[1], ids[0]],
    });
    expect(res.status).toBe(200);
    expect(res.body.map((d: { name: string }) => d.name)).toEqual(['Sales', 'Marketing', 'Všeobecné']);

    // GET reflects the persisted order (0,1,2 reassigned by array index).
    const after = await admin.get('/api/departments');
    expect(after.body.map((d: { name: string }) => d.name)).toEqual(['Sales', 'Marketing', 'Všeobecné']);
    expect(after.body.map((d: { order: number }) => d.order)).toEqual([0, 1, 2]);
  });

  test('PATCH /reorder with a set that is not an exact permutation returns 400', async () => {
    const admin = await loggedInAdmin();
    await prisma.department.create({ data: { name: 'Marketing', order: 1 } });

    const all = await prisma.department.findMany();
    const ids = all.map((d) => d.id);

    // Drop one id -> wrong size / set.
    const res = await withCsrf(admin.patch('/api/departments/reorder')).send({ ids: [ids[0]] });
    expect(res.status).toBe(400);
  });
});
