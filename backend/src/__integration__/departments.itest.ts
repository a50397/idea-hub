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
  validIdeaPayload,
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

describe('department notification emails (real DB)', () => {
  // The critical missing-field proof. Pre-existing department documents predate the
  // notificationEmails field. Raw-insert a department WITHOUT that field (as a legacy
  // doc genuinely is) and prove what Prisma does on read: for a missing scalar LIST,
  // the Mongo connector returns [] (unlike a missing scalar ObjectId, which it cannot
  // even match — see ensureDepartments). Because reads return [] rather than crashing,
  // NO $runCommandRaw backfill is required.
  test('a department document missing notificationEmails reads back as [] via Prisma', async () => {
    // Insert a raw Mongo document with no notificationEmails field. createdAt/updatedAt
    // are supplied because Prisma requires those on read; notificationEmails is omitted.
    await prisma.$runCommandRaw({
      insert: 'departments',
      documents: [
        {
          name: 'Legacy No Emails',
          order: 77,
          createdAt: { $date: '2026-01-01T00:00:00.000Z' },
          updatedAt: { $date: '2026-01-01T00:00:00.000Z' },
        },
      ],
    });

    // findUnique/findFirst read path must not crash and must yield [].
    const one = await prisma.department.findFirst({ where: { name: 'Legacy No Emails' } });
    expect(one).not.toBeNull();
    expect(one!.notificationEmails).toEqual([]);

    // findMany (the path the GET /api/departments route uses) must not crash either.
    const many = await prisma.department.findMany();
    const legacy = many.find((d) => d.name === 'Legacy No Emails');
    expect(legacy!.notificationEmails).toEqual([]);

    // And the PATCH route can populate the previously-absent field.
    const admin = await loggedInAdmin();
    const res = await withCsrf(admin.patch(`/api/departments/${one!.id}`)).send({
      notificationEmails: ['ops@corp.example'],
    });
    expect(res.status).toBe(200);
    expect(res.body.notificationEmails).toEqual(['ops@corp.example']);

    const after = await prisma.department.findUnique({ where: { id: one!.id } });
    expect(after!.notificationEmails).toEqual(['ops@corp.example']);
  });

  test('notification emails persist through PATCH and are visible to admins on GET', async () => {
    const admin = await loggedInAdmin();
    const dept = await prisma.department.create({ data: { name: 'Persisted', order: 5 } });

    const set = await withCsrf(admin.patch(`/api/departments/${dept.id}`)).send({
      notificationEmails: ['  a@corp.example ', 'a@corp.example', 'b@corp.example'],
    });
    expect(set.status).toBe(200);
    // Trimmed + de-duplicated by the API.
    expect(set.body.notificationEmails).toEqual(['a@corp.example', 'b@corp.example']);

    // Persisted at the DB layer.
    const stored = await prisma.department.findUnique({ where: { id: dept.id } });
    expect(stored!.notificationEmails).toEqual(['a@corp.example', 'b@corp.example']);

    // Admin GET surfaces them.
    const list = await admin.get('/api/departments');
    const row = list.body.find((d: { id: string }) => d.id === dept.id);
    expect(row.notificationEmails).toEqual(['a@corp.example', 'b@corp.example']);

    // An empty array clears the list.
    const cleared = await withCsrf(admin.patch(`/api/departments/${dept.id}`)).send({
      notificationEmails: [],
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.notificationEmails).toEqual([]);
  });

  test('a non-admin GET never exposes notificationEmails', async () => {
    const admin = await loggedInAdmin();
    const dept = await prisma.department.create({ data: { name: 'Secret Recipients', order: 6 } });
    await withCsrf(admin.patch(`/api/departments/${dept.id}`)).send({
      notificationEmails: ['confidential@corp.example'],
    });

    await createUser({ email: 'plainuser@dep.test', password: 'usersecret1', role: Role.USER });
    const user = newAgent();
    await loginAs(user, 'plainuser@dep.test', 'usersecret1');

    const list = await user.get('/api/departments');
    expect(list.status).toBe(200);
    for (const row of list.body) {
      expect(row).not.toHaveProperty('notificationEmails');
    }
  });

  test('ensureDepartments (reseed) preserves an existing department\'s notification emails', async () => {
    // Set emails on the seeded default, then re-run the boot reseed. It must be
    // idempotent w.r.t. the new field — never clobbering configured recipients.
    const defaultId = await getDefaultDepartmentId();
    await prisma.department.update({
      where: { id: defaultId },
      data: { notificationEmails: ['kept@corp.example'] },
    });

    await ensureDepartments();

    const after = await prisma.department.findUnique({ where: { id: defaultId } });
    expect(after!.notificationEmails).toEqual(['kept@corp.example']);
  });

  test('POST /api/ideas succeeds (201) with a populated notification list and mail disabled', async () => {
    // No MailSettings document exists (resetDb clears it) -> mail is disabled, so
    // the mailer is log-only and resolves true. Creating an idea against a department
    // WITH recipients must still return a clean 201 and never crash: the send is
    // fire-and-forget and best-effort.
    const admin = await loggedInAdmin();
    const defaultId = await getDefaultDepartmentId();
    await withCsrf(admin.patch(`/api/departments/${defaultId}`)).send({
      notificationEmails: ['ops@corp.example', 'lead@corp.example'],
    });

    const submitter = await createUser({ email: 'submitter@dep.test', password: 'submitsecret1' });
    const agent = newAgent();
    await loginAs(agent, 'submitter@dep.test', 'submitsecret1');

    const res = await withCsrf(agent.post('/api/ideas')).send(validIdeaPayload(defaultId));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'SUBMITTED', departmentId: defaultId });

    // The idea really landed.
    expect(await prisma.idea.count({ where: { submitterId: submitter.id } })).toBe(1);
  });
});
