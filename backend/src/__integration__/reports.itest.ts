// Requirement 5: reports computed by real Prisma/Mongo aggregations —
// /summary (with USER role-scoped visibility), /monthly-trend, and /filtered
// including the CSV export shape.
import {
  Role,
  IdeaStatus,
  newAgent,
  loginAs,
  waitForBoot,
  resetDb,
  createUser,
  createIdea,
} from './support/helpers';

let adminAgent: ReturnType<typeof newAgent>;
let userAgent: ReturnType<typeof newAgent>;
let userU: { id: string };
let other: { id: string };

const CSV_HEADER =
  'ID,Title,Status,Effort,Submitter,Approver,Assignee,Submitted At,Approved At,Started At,Completed At,Duration (days),Tags';

beforeAll(async () => {
  await waitForBoot();
  await resetDb();

  const admin = await createUser({ email: 'admin@reports.test', password: 'pw', role: Role.ADMIN });
  const power = await createUser({ email: 'power@reports.test', password: 'pw', role: Role.POWER_USER });
  userU = await createUser({ email: 'u@reports.test', password: 'pw', role: Role.USER });
  other = await createUser({ email: 'o@reports.test', password: null, role: Role.USER });

  // userU's ideas: 1 SUBMITTED, 1 IN_PROGRESS, 1 DONE (completed 2026-03).
  await createIdea({ submitterId: userU.id, status: IdeaStatus.SUBMITTED, submittedAt: new Date('2026-02-01') });
  await createIdea({ submitterId: userU.id, status: IdeaStatus.IN_PROGRESS, approverId: power.id, assigneeId: userU.id, submittedAt: new Date('2026-02-05'), approvedAt: new Date('2026-02-06'), startedAt: new Date('2026-02-07') });
  await createIdea({ submitterId: userU.id, status: IdeaStatus.DONE, approverId: power.id, assigneeId: userU.id, submittedAt: new Date('2026-03-01'), approvedAt: new Date('2026-03-03'), startedAt: new Date('2026-03-05'), completedAt: new Date('2026-03-15') });

  // other's ideas: 1 SUBMITTED, 1 APPROVED, 1 DONE (completed 2026-05), 1 REJECTED.
  await createIdea({ submitterId: other.id, status: IdeaStatus.SUBMITTED, submittedAt: new Date('2026-02-02') });
  await createIdea({ submitterId: other.id, status: IdeaStatus.APPROVED, approverId: power.id, submittedAt: new Date('2026-02-10'), approvedAt: new Date('2026-02-12') });
  await createIdea({ submitterId: other.id, status: IdeaStatus.DONE, approverId: admin.id, assigneeId: power.id, submittedAt: new Date('2026-04-01'), approvedAt: new Date('2026-04-03'), startedAt: new Date('2026-04-05'), completedAt: new Date('2026-05-20') });
  await createIdea({ submitterId: other.id, status: IdeaStatus.REJECTED, approverId: power.id, submittedAt: new Date('2026-02-15'), rejectedAt: new Date('2026-02-16') });

  adminAgent = newAgent();
  expect((await loginAs(adminAgent, 'admin@reports.test', 'pw')).status).toBe(200);
  userAgent = newAgent();
  expect((await loginAs(userAgent, 'u@reports.test', 'pw')).status).toBe(200);
});

describe('reports aggregations (real DB)', () => {
  test('GET /summary as ADMIN counts all ideas', async () => {
    const res = await adminAgent.get('/api/reports/summary');
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({
      submitted: 2,
      approved: 1,
      inProgress: 1,
      done: 2,
      rejected: 1,
      total: 7,
    });
    expect(typeof res.body.averageTimes.submittedToApprovedDays).toBe('number');
    expect(typeof res.body.averageTimes.approvedToDoneDays).toBe('number');
  });

  test('GET /summary as USER is scoped to the user\'s own ideas', async () => {
    const res = await userAgent.get('/api/reports/summary');
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({
      submitted: 1,
      approved: 0,
      inProgress: 1,
      done: 1,
      rejected: 0,
      total: 3,
    });
  });

  test('GET /monthly-trend as ADMIN groups completed ideas by month', async () => {
    const res = await adminAgent.get('/api/reports/monthly-trend');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { month: '2026-03', count: 1 },
      { month: '2026-05', count: 1 },
    ]);
  });

  test('GET /monthly-trend as USER only counts the user\'s completed ideas', async () => {
    const res = await userAgent.get('/api/reports/monthly-trend');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ month: '2026-03', count: 1 }]);
  });

  test('GET /filtered (json) as ADMIN honors a status filter with pagination', async () => {
    const res = await adminAgent.get('/api/reports/filtered').query({ status: 'DONE' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toMatchObject({ total: 2 });
    expect(res.body.data.every((i: any) => i.status === 'DONE')).toBe(true);
  });

  test('GET /filtered CSV export has the expected headers and row shape', async () => {
    const res = await adminAgent.get('/api/reports/filtered').query({ status: 'DONE', format: 'csv' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe('attachment; filename=ideas-report.csv');

    const lines = res.text.split('\n');
    expect(lines[0]).toBe(CSV_HEADER);
    expect(lines[0].split(',')).toHaveLength(13);
    // header + one row per DONE idea
    expect(lines).toHaveLength(3);
  });

  test('GET /filtered as USER is forced to the user\'s own ideas (ignores submitterId)', async () => {
    const res = await userAgent
      .get('/api/reports/filtered')
      .query({ submitterId: other.id }); // attempt to read someone else's ideas
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(3); // only userU's three ideas
    expect(res.body.data.every((i: any) => i.submitter.id === userU.id)).toBe(true);
  });

  test('GET /filtered as USER combined with a status filter stays scoped', async () => {
    const res = await userAgent.get('/api/reports/filtered').query({ status: 'DONE' });
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0].submitter.id).toBe(userU.id);
  });
});
