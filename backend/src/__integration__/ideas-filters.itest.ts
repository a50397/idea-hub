// Requirement 4: GET /api/ideas filters + pagination against seeded real data.
import {
  Role,
  IdeaStatus,
  Effort,
  newAgent,
  loginAs,
  waitForBoot,
  resetDb,
  createUser,
  createIdea,
} from './support/helpers';

let agent: ReturnType<typeof newAgent>;
let submitterA: { id: string };
let submitterB: { id: string };

const base = Date.now();
const at = (minutesAgo: number) => new Date(base - minutesAgo * 60_000);

beforeAll(async () => {
  await waitForBoot();
  await resetDb();

  await createUser({ email: 'admin@filters.test', password: 'pw', role: Role.ADMIN });
  submitterA = await createUser({ email: 'a@filters.test', role: Role.USER, password: null });
  submitterB = await createUser({ email: 'b@filters.test', role: Role.USER, password: null });
  const approver = await createUser({ email: 'p@filters.test', role: Role.POWER_USER, password: null });

  // submittedAt (desc) order will be i1, i2, i3, i4, i5.
  await createIdea({ submitterId: submitterA.id, status: IdeaStatus.SUBMITTED, tags: ['alpha', 'x'], submittedAt: at(1) });
  await createIdea({ submitterId: submitterA.id, status: IdeaStatus.APPROVED, tags: ['beta'], approverId: approver.id, approvedAt: at(1), submittedAt: at(2) });
  await createIdea({ submitterId: submitterB.id, status: IdeaStatus.SUBMITTED, tags: ['alpha'], submittedAt: at(3) });
  await createIdea({ submitterId: submitterB.id, status: IdeaStatus.DONE, tags: ['gamma'], effort: Effort.MORE_THAN_THREE_DAYS, approverId: approver.id, assigneeId: submitterB.id, approvedAt: at(3), startedAt: at(2), completedAt: at(1), submittedAt: at(4) });
  await createIdea({ submitterId: submitterA.id, status: IdeaStatus.IN_PROGRESS, tags: ['x', 'gamma'], approverId: approver.id, assigneeId: submitterA.id, approvedAt: at(4), startedAt: at(3), submittedAt: at(5) });

  agent = newAgent();
  const login = await loginAs(agent, 'admin@filters.test', 'pw');
  expect(login.status).toBe(200);
});

describe('GET /api/ideas filters + pagination (real DB)', () => {
  test('no filter returns all ideas, newest first, with pagination metadata', async () => {
    const res = await agent.get('/api/ideas');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 20, total: 5, totalPages: 1 });
    // ordered by submittedAt desc
    const times = res.body.data.map((i: any) => new Date(i.submittedAt).getTime());
    expect(times).toEqual([...times].sort((x, y) => y - x));
  });

  test('filter by status=SUBMITTED', async () => {
    const res = await agent.get('/api/ideas').query({ status: 'SUBMITTED' });
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.data.every((i: any) => i.status === 'SUBMITTED')).toBe(true);
  });

  test('filter by submitterId', async () => {
    const res = await agent.get('/api/ideas').query({ submitterId: submitterA.id });
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(3);
    expect(res.body.data.every((i: any) => i.submitter.id === submitterA.id)).toBe(true);
  });

  test('filter by tag (hasSome)', async () => {
    const res = await agent.get('/api/ideas').query({ tags: 'alpha' });
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.data.every((i: any) => i.tags.includes('alpha'))).toBe(true);
  });

  test('pagination page 1 of limit 2', async () => {
    const res = await agent.get('/api/ideas').query({ page: 1, limit: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 2, total: 5, totalPages: 3 });
  });

  test('pagination last page returns the remainder', async () => {
    const res = await agent.get('/api/ideas').query({ page: 3, limit: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toMatchObject({ page: 3, limit: 2, total: 5, totalPages: 3 });
  });

  test('combined status + submitterId filter', async () => {
    const res = await agent.get('/api/ideas').query({ status: 'SUBMITTED', submitterId: submitterA.id });
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({ status: 'SUBMITTED' });
    expect(res.body.data[0].submitter.id).toBe(submitterA.id);
  });

  test('an invalid submitterId is rejected with 400', async () => {
    const res = await agent.get('/api/ideas').query({ submitterId: 'not-an-object-id' });
    expect(res.status).toBe(400);
  });
});
