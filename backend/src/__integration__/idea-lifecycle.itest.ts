// Requirement 3: the full idea lifecycle across roles, exercised end-to-end
// against the real DB — submit (USER) -> approve (POWER_USER) -> claim (assignee)
// -> add step -> complete (assignee) — asserting status transitions, timestamps,
// IdeaEvent rows, IdeaStep creation, and the authorization failures.
import { EventType } from '@prisma/client';
import {
  app,
  Role,
  IdeaStatus,
  prisma,
  newAgent,
  loginAs,
  withCsrf,
  waitForBoot,
  resetDb,
  createUser,
  createIdea,
  validIdeaPayload,
  getDefaultDepartmentId,
} from './support/helpers';
import request from 'supertest';
import { ensureIdeaNotifyDefaults } from '../utils/init-idea-notify';

beforeAll(async () => {
  await waitForBoot();
});

beforeEach(async () => {
  await resetDb();
});

async function seedActors() {
  const submitter = await createUser({ email: 'submitter@life.test', password: 'pw', role: Role.USER });
  const approver = await createUser({ email: 'approver@life.test', password: 'pw', role: Role.POWER_USER });
  const assignee = await createUser({ email: 'assignee@life.test', password: 'pw', role: Role.USER });
  return { submitter, approver, assignee };
}

describe('idea lifecycle across roles (real DB)', () => {
  test('submit -> approve -> claim -> step -> complete, with events, steps and timestamps', async () => {
    const { submitter, approver, assignee } = await seedActors();

    // 1) USER submits.
    const submitterAgent = newAgent();
    await loginAs(submitterAgent, 'submitter@life.test', 'pw');
    const departmentId = await getDefaultDepartmentId();
    const submitRes = await withCsrf(submitterAgent.post('/api/ideas')).send(validIdeaPayload(departmentId));
    expect(submitRes.status).toBe(201);
    expect(submitRes.body.status).toBe('SUBMITTED');
    expect(submitRes.body.submitterId).toBe(submitter.id);
    const ideaId: string = submitRes.body.id;

    let events = await prisma.ideaEvent.findMany({ where: { ideaId }, orderBy: { timestamp: 'asc' } });
    expect(events.map((e) => e.type)).toEqual([EventType.SUBMITTED]);
    expect(events[0].byUserId).toBe(submitter.id);

    // 2) POWER_USER approves.
    const approverAgent = newAgent();
    await loginAs(approverAgent, 'approver@life.test', 'pw');
    const approveRes = await withCsrf(approverAgent.patch(`/api/ideas/${ideaId}/approve`)).send({
      note: 'Looks good',
    });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe('APPROVED');
    expect(approveRes.body.approverId).toBe(approver.id);
    expect(approveRes.body.approvedAt).toBeTruthy();

    // 3) Assignee claims.
    const assigneeAgent = newAgent();
    await loginAs(assigneeAgent, 'assignee@life.test', 'pw');
    const claimRes = await withCsrf(assigneeAgent.patch(`/api/ideas/${ideaId}/claim`));
    expect(claimRes.status).toBe(200);
    expect(claimRes.body.status).toBe('IN_PROGRESS');
    expect(claimRes.body.assigneeId).toBe(assignee.id);
    expect(claimRes.body.startedAt).toBeTruthy();

    // 4) Assignee adds a progress step.
    const stepRes = await withCsrf(assigneeAgent.post(`/api/ideas/${ideaId}/steps`)).send({
      text: 'Started drafting the plan',
    });
    expect(stepRes.status).toBe(201);
    const steps = await prisma.ideaStep.findMany({ where: { ideaId } });
    expect(steps).toHaveLength(1);
    expect(steps[0].text).toBe('Started drafting the plan');

    // 5) Assignee completes.
    const completeRes = await withCsrf(assigneeAgent.patch(`/api/ideas/${ideaId}/complete`)).send({
      note: 'Done!',
    });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.status).toBe('DONE');
    expect(completeRes.body.completedAt).toBeTruthy();

    // Final persisted state: one event per transition, in order, by the right user.
    const finalIdea = await prisma.idea.findUnique({ where: { id: ideaId } });
    expect(finalIdea).toMatchObject({ status: 'DONE', submitterId: submitter.id, approverId: approver.id, assigneeId: assignee.id });
    expect(finalIdea!.submittedAt).toBeInstanceOf(Date);
    expect(finalIdea!.approvedAt).toBeInstanceOf(Date);
    expect(finalIdea!.startedAt).toBeInstanceOf(Date);
    expect(finalIdea!.completedAt).toBeInstanceOf(Date);

    events = await prisma.ideaEvent.findMany({ where: { ideaId }, orderBy: { timestamp: 'asc' } });
    expect(events.map((e) => e.type)).toEqual([
      EventType.SUBMITTED,
      EventType.APPROVED,
      EventType.CLAIMED,
      EventType.COMPLETED,
    ]);
    expect(events.map((e) => e.byUserId)).toEqual([submitter.id, approver.id, assignee.id, assignee.id]);
  });

  test('submitting an idea without a session is 401', async () => {
    const departmentId = await getDefaultDepartmentId();
    const res = await withCsrf(request(app).post('/api/ideas')).send(validIdeaPayload(departmentId));
    expect(res.status).toBe(401);
  });

  test('a USER cannot approve an idea (403 wrong role)', async () => {
    const { submitter } = await seedActors();
    const idea = await createIdea({ submitterId: submitter.id, status: IdeaStatus.SUBMITTED });

    const submitterAgent = newAgent();
    await loginAs(submitterAgent, 'submitter@life.test', 'pw');
    const res = await withCsrf(submitterAgent.patch(`/api/ideas/${idea.id}/approve`)).send({});
    expect(res.status).toBe(403);
  });

  test('approving without a session is 401', async () => {
    const { submitter } = await seedActors();
    const idea = await createIdea({ submitterId: submitter.id, status: IdeaStatus.SUBMITTED });
    const res = await withCsrf(request(app).patch(`/api/ideas/${idea.id}/approve`)).send({});
    expect(res.status).toBe(401);
  });

  test('a non-assignee cannot complete an in-progress idea (403 wrong user)', async () => {
    const { submitter, approver, assignee } = await seedActors();
    const idea = await createIdea({
      submitterId: submitter.id,
      approverId: approver.id,
      assigneeId: assignee.id,
      status: IdeaStatus.IN_PROGRESS,
      startedAt: new Date(),
      approvedAt: new Date(),
    });

    // approver (not the assignee) tries to complete
    const approverAgent = newAgent();
    await loginAs(approverAgent, 'approver@life.test', 'pw');
    const res = await withCsrf(approverAgent.patch(`/api/ideas/${idea.id}/complete`)).send({});
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error', 'Only the assignee can complete this idea');

    // Still IN_PROGRESS in the DB.
    const after = await prisma.idea.findUnique({ where: { id: idea.id } });
    expect(after!.status).toBe('IN_PROGRESS');
  });

  test('a non-submitter cannot update someone else\'s idea (403)', async () => {
    const { submitter, assignee } = await seedActors();
    const idea = await createIdea({ submitterId: submitter.id, status: IdeaStatus.SUBMITTED });

    const otherAgent = newAgent();
    await loginAs(otherAgent, 'assignee@life.test', 'pw');
    const res = await withCsrf(otherAgent.patch(`/api/ideas/${idea.id}`)).send({ title: 'Hijacked title' });
    expect(res.status).toBe(403);
  });

  test('claiming an idea that is not APPROVED is rejected (400)', async () => {
    const { submitter, assignee } = await seedActors();
    const idea = await createIdea({ submitterId: submitter.id, status: IdeaStatus.SUBMITTED });

    const assigneeAgent = newAgent();
    await loginAs(assigneeAgent, 'assignee@life.test', 'pw');
    const res = await withCsrf(assigneeAgent.patch(`/api/ideas/${idea.id}/claim`));
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Can only claim ideas in APPROVED status');
  });

  // The missing-field proof for notifyOnChange. Pre-existing idea documents predate
  // the field; a raw insert reproduces one faithfully. Prove: (1) a missing nullable
  // Boolean reads back as null via Prisma and the API surfaces it as opted-out;
  // (2) the boot backfill (ensureIdeaNotifyDefaults) — what an existing deployment
  // runs on upgrade — MATCHES the missing-field doc (Prisma updateMany cannot) and
  // sets the strict-opt-out default false; (3) the submitter (and only the
  // submitter) can then opt in via the notify endpoint, which writes no IdeaEvent.
  test('a legacy idea without notifyOnChange: reads null, API opts it out, boot backfill sets false, submitter opts in', async () => {
    const { submitter } = await seedActors();
    const departmentId = await getDefaultDepartmentId();

    // Raw-insert a legacy idea document WITHOUT the notifyOnChange field.
    // submitterId/departmentId are @db.ObjectId, so they use the {$oid} form.
    await prisma.$runCommandRaw({
      insert: 'ideas',
      documents: [
        {
          title: 'Legacy idea without a notify flag',
          description: 'A sufficiently detailed legacy idea description.',
          benefits: 'Clear and measurable benefits described here.',
          effort: 'LESS_THAN_ONE_DAY',
          status: 'SUBMITTED',
          tags: [],
          submitterId: { $oid: submitter.id },
          departmentId: { $oid: departmentId },
          submittedAt: { $date: '2026-01-01T00:00:00.000Z' },
          createdAt: { $date: '2026-01-01T00:00:00.000Z' },
          updatedAt: { $date: '2026-01-01T00:00:00.000Z' },
        },
      ],
    });

    // (1a) A missing nullable Boolean reads back as null via Prisma (no crash).
    const legacy = await prisma.idea.findFirst({ where: { title: 'Legacy idea without a notify flag' } });
    expect(legacy).not.toBeNull();
    expect(legacy!.notifyOnChange).toBeNull();

    // (1b) The API returns null and treats it as opted out (read paths handle
    // null==false regardless of the backfill — defense in depth).
    const submitterAgent = newAgent();
    await loginAs(submitterAgent, 'submitter@life.test', 'pw');
    const getRes = await submitterAgent.get(`/api/ideas/${legacy!.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.notifyOnChange).toBeNull();

    // (2) The boot backfill matches the missing field and writes the default false.
    await ensureIdeaNotifyDefaults();
    const backfilled = await prisma.idea.findUnique({ where: { id: legacy!.id } });
    expect(backfilled!.notifyOnChange).toBe(false);

    // (3a) A non-submitter cannot flip the toggle.
    const otherAgent = newAgent();
    await loginAs(otherAgent, 'assignee@life.test', 'pw');
    const forbidden = await withCsrf(otherAgent.patch(`/api/ideas/${legacy!.id}/notify`)).send({ enabled: true });
    expect(forbidden.status).toBe(403);

    // (3b) The submitter opts in; the field flips and persists.
    const notifyRes = await withCsrf(submitterAgent.patch(`/api/ideas/${legacy!.id}/notify`)).send({ enabled: true });
    expect(notifyRes.status).toBe(200);
    expect(notifyRes.body.notifyOnChange).toBe(true);
    const after = await prisma.idea.findUnique({ where: { id: legacy!.id } });
    expect(after!.notifyOnChange).toBe(true);

    // The toggle is a preference change, not a lifecycle action: no IdeaEvent.
    const events = await prisma.ideaEvent.findMany({ where: { ideaId: legacy!.id } });
    expect(events).toHaveLength(0);
  });
});
