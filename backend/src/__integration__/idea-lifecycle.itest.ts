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
} from './support/helpers';
import request from 'supertest';

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
    const submitRes = await withCsrf(submitterAgent.post('/api/ideas')).send(validIdeaPayload());
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
    const res = await withCsrf(request(app).post('/api/ideas')).send(validIdeaPayload());
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
});
