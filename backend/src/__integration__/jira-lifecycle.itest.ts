// The Jira execution flow end-to-end against the REAL database and the REAL app,
// with an in-suite mock Jira Cloud (node:http on an ephemeral port) reached through
// the JIRA_API_BASE_URL override.
//
// What only this tier can prove (and therefore what it focuses on):
//   - the MISSING-vs-NULL rule against real Mongo: a Prisma where-clause does not
//     match a missing scalar, which is why POST /api/ideas writes an explicit
//     jiraSyncActive and why the boot backfill exists,
//   - a NULL IdeaEvent.byUserId genuinely round-trips Mongo and the API (the poller
//     writes user-less events; a required column would have rejected them),
//   - the full dispatch -> poll -> transition cycle over real documents, including
//     the cancel/re-dispatch loop and the two-tick deletion rule.
//
// The poll TIMER is not registered in this tier (NODE_ENV=test without
// JIRA_POLL_INTERVAL_MS — see index.ts), so every tick here is an explicit,
// deterministic runJiraSyncOnce() call.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { EventType } from '@prisma/client';
import {
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
  setJiraSettings,
  getDefaultDepartmentId,
} from './support/helpers';
import { runJiraSyncOnce, resetJiraSyncState } from '../utils/jira-sync';
import { ensureIdeaJiraDefaults } from '../utils/init-idea-jira';

// ---------------------------------------------------------------------------
// Mock Jira Cloud
// ---------------------------------------------------------------------------

interface MockIssue {
  id: string;
  key: string;
  statusName: string;
  categoryKey: 'new' | 'indeterminate' | 'done';
  assignee: string | null;
  resolution: string | null;
  /** Deleted issues 404 on GET and vanish from search. */
  deleted: boolean;
  /** Hidden from SEARCH only — models Jira's eventual consistency. */
  hiddenFromSearch: boolean;
}

const mockIssues = new Map<string, MockIssue>();
let nextIssueId = 10001;
/** Every request the mock saw: used to assert auth and payload shape. */
let requests: Array<{ method: string; url: string; auth: string | undefined; body: any }> = [];
let server: http.Server;
let mockBaseUrl = '';
let savedBaseUrlEnv: string | undefined;

function resetMockJira(): void {
  mockIssues.clear();
  nextIssueId = 10001;
  requests = [];
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.length === 0) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
  });
}

function issuePayload(issue: MockIssue) {
  return {
    id: issue.id,
    key: issue.key,
    fields: {
      status: { name: issue.statusName, statusCategory: { key: issue.categoryKey } },
      assignee: issue.assignee === null ? null : { displayName: issue.assignee },
      resolution: issue.resolution === null ? null : { name: issue.resolution },
    },
  };
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body ?? {});
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = req.url ?? '';
  const body = await readBody(req);
  requests.push({ method: req.method ?? '', url, auth: req.headers.authorization, body });

  // Create an issue.
  if (req.method === 'POST' && url === '/rest/api/3/issue') {
    const projectKey = body?.fields?.project?.key ?? 'OPS';
    const id = String(nextIssueId++);
    const issue: MockIssue = {
      id,
      key: `${projectKey}-${id.slice(-1)}`,
      statusName: 'To Do',
      categoryKey: 'new',
      assignee: null,
      resolution: null,
      deleted: false,
      hiddenFromSearch: false,
    };
    mockIssues.set(id, issue);
    return send(res, 201, { id: issue.id, key: issue.key });
  }

  // Search by the bounded `id in (...)` JQL.
  if (req.method === 'POST' && url === '/rest/api/3/search/jql') {
    const jql: string = body?.jql ?? '';
    const ids = (jql.match(/\d+/g) ?? []) as string[];
    const found = ids
      .map((id) => mockIssues.get(id))
      .filter((issue): issue is MockIssue => issue !== undefined && !issue.deleted && !issue.hiddenFromSearch)
      .map(issuePayload);
    return send(res, 200, { issues: found });
  }

  // Read one issue (the deletion-confirm primitive).
  const singleIssue = /^\/rest\/api\/3\/issue\/(\d+)/.exec(url);
  if (req.method === 'GET' && singleIssue) {
    const issue = mockIssues.get(singleIssue[1]);
    if (!issue || issue.deleted) return send(res, 404, { errorMessages: ['Issue does not exist'] });
    return send(res, 200, issuePayload(issue));
  }

  if (req.method === 'GET' && url === '/rest/api/3/myself') {
    return send(res, 200, { accountId: 'mock-account' });
  }

  if (req.method === 'GET' && url.startsWith('/rest/api/3/project/search')) {
    return send(res, 200, { isLast: true, values: [{ key: 'OPS', name: 'Operations' }] });
  }

  return send(res, 404, { errorMessages: ['Unknown endpoint'] });
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    void handle(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  mockBaseUrl = `http://127.0.0.1:${port}`;
  // The env override wins over the stored (https) base URL for BOTH outbound calls
  // and the browse URL, and is the only way a plain-http target is ever accepted.
  savedBaseUrlEnv = process.env.JIRA_API_BASE_URL;
  process.env.JIRA_API_BASE_URL = mockBaseUrl;
  await waitForBoot();
});

afterAll(async () => {
  if (savedBaseUrlEnv === undefined) delete process.env.JIRA_API_BASE_URL;
  else process.env.JIRA_API_BASE_URL = savedBaseUrlEnv;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  await resetDb();
  resetMockJira();
  resetJiraSyncState();
  await setJiraSettings();
});

async function seedActors() {
  const submitter = await createUser({ email: 'submitter@jira.test', password: 'pw', role: Role.USER });
  const power = await createUser({ email: 'power@jira.test', password: 'pw', role: Role.POWER_USER });
  return { submitter, power };
}

/** An APPROVED idea ready to dispatch. */
async function approvedIdea(submitterId: string, approverId: string, overrides: Record<string, unknown> = {}) {
  return createIdea({
    submitterId,
    approverId,
    status: IdeaStatus.APPROVED,
    approvedAt: new Date(),
    ...overrides,
  });
}

async function powerAgent() {
  const agent = newAgent();
  const res = await loginAs(agent, 'power@jira.test', 'pw');
  expect(res.status).toBe(200);
  return agent;
}

/** Mutate the mock issue the given idea points at. */
async function mutateIssue(ideaId: string, changes: Partial<MockIssue>): Promise<void> {
  const idea = await prisma.idea.findUnique({ where: { id: ideaId } });
  const issue = mockIssues.get(idea!.jiraIssueId as string);
  Object.assign(issue as MockIssue, changes);
}

describe('jira dispatch + poll lifecycle (real DB, mock Jira)', () => {
  test('dispatch: creates the issue, mirrors it, records the event and returns the browse URL', async () => {
    const { submitter, power } = await seedActors();
    const idea = await approvedIdea(submitter.id, power.id);

    const agent = await powerAgent();
    const res = await withCsrf(agent.post(`/api/ideas/${idea.id}/jira-task`)).send({});

    expect(res.status).toBe(200);
    // The idea STAYS APPROVED: a fresh Jira issue sits in the `new` (To Do) category.
    expect(res.body.status).toBe('APPROVED');
    expect(res.body.jiraIssueKey).toBe('OPS-1');
    // The browse URL is built from the ENV-sourced base, so plain http is accepted.
    expect(res.body.jiraBrowseUrl).toBe(`${mockBaseUrl}/browse/OPS-1`);

    // Persisted mirror state.
    const stored = await prisma.idea.findUnique({ where: { id: idea.id } });
    expect(stored).toMatchObject({
      status: 'APPROVED',
      assigneeId: null,
      jiraIssueKey: 'OPS-1',
      jiraStatusCategory: 'new',
      jiraSyncActive: true,
      jiraStatus: null,
      jiraAssignee: null,
      jiraResolution: null,
    });
    expect(stored!.jiraIssueId).toMatch(/^\d+$/);
    expect(stored!.jiraLastSyncAt).toBeInstanceOf(Date);

    // The timeline records the dispatch, attributed to the acting user.
    const events = await prisma.ideaEvent.findMany({ where: { ideaId: idea.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: EventType.JIRA_CREATED, byUserId: power.id });
    expect(events[0].note).toContain('OPS-1');

    // The outbound request carried HTTP Basic auth and an ADF description.
    const create = requests.find((r) => r.url === '/rest/api/3/issue');
    expect(create!.auth).toBe(
      `Basic ${Buffer.from('tech@itest.example:itest-jira-token').toString('base64')}`
    );
    expect(create!.body.fields.description.type).toBe('doc');
    expect(create!.body.fields.description.version).toBe(1);
    expect(create!.body.fields.project.key).toBe('OPS');
    expect(create!.body.fields).not.toHaveProperty('labels');
  });

  test('a regular USER cannot dispatch (403) and no issue is created', async () => {
    const { submitter, power } = await seedActors();
    const idea = await approvedIdea(submitter.id, power.id);

    const agent = newAgent();
    await loginAs(agent, 'submitter@jira.test', 'pw');
    const res = await withCsrf(agent.post(`/api/ideas/${idea.id}/jira-task`)).send({});

    expect(res.status).toBe(403);
    expect(mockIssues.size).toBe(0);
    const stored = await prisma.idea.findUnique({ where: { id: idea.id } });
    expect(stored!.jiraSyncActive).toBe(false);
  });

  test('a second dispatch of the same idea is refused (409) — no duplicate Jira issue', async () => {
    const { submitter, power } = await seedActors();
    const idea = await approvedIdea(submitter.id, power.id);
    const agent = await powerAgent();

    expect((await withCsrf(agent.post(`/api/ideas/${idea.id}/jira-task`)).send({})).status).toBe(200);
    const second = await withCsrf(agent.post(`/api/ideas/${idea.id}/jira-task`)).send({});

    expect(second.status).toBe(409);
    expect(mockIssues.size).toBe(1);
  });

  test('the department project override wins over the installation-wide default', async () => {
    const { submitter, power } = await seedActors();
    const departmentId = await getDefaultDepartmentId();
    await prisma.department.update({ where: { id: departmentId }, data: { jiraProjectKey: 'MKT' } });
    const idea = await approvedIdea(submitter.id, power.id, { departmentId });

    const agent = await powerAgent();
    const res = await withCsrf(agent.post(`/api/ideas/${idea.id}/jira-task`)).send({});

    expect(res.status).toBe(200);
    expect(res.body.jiraIssueKey).toBe('MKT-1');
  });

  test('dispatch is refused with 400 when Jira is not effectively configured', async () => {
    const { submitter, power } = await seedActors();
    await setJiraSettings({ enabled: false });
    const idea = await approvedIdea(submitter.id, power.id);

    const agent = await powerAgent();
    const res = await withCsrf(agent.post(`/api/ideas/${idea.id}/jira-task`)).send({});

    expect(res.status).toBe(400);
    expect(mockIssues.size).toBe(0);
  });

  // The full mirror cycle over real documents.
  test('poll: To Do -> In Progress -> Done drives the idea lifecycle and writes USER-LESS events', async () => {
    const { submitter, power } = await seedActors();
    const idea = await approvedIdea(submitter.id, power.id);
    const agent = await powerAgent();
    await withCsrf(agent.post(`/api/ideas/${idea.id}/jira-task`)).send({});

    // Tick 1: nothing changed in Jira -> only the poll timestamp moves.
    await runJiraSyncOnce();
    let stored = await prisma.idea.findUnique({ where: { id: idea.id } });
    expect(stored!.status).toBe('APPROVED');
    expect(await prisma.ideaEvent.count({ where: { ideaId: idea.id } })).toBe(1);
    // A completed run also records its health on the settings singleton (what the
    // admin banner and the settings page read) — over a real document, so the
    // nullable-by-default columns round-trip Mongo.
    const health = await prisma.jiraSettings.findUnique({ where: { singleton: 'singleton' } });
    expect(health).toMatchObject({ lastSyncOk: true, lastSyncReason: null });

    // Tick 2: work starts.
    await mutateIssue(idea.id, {
      statusName: 'In Progress',
      categoryKey: 'indeterminate',
      assignee: 'Remote Person',
    });
    await runJiraSyncOnce();

    stored = await prisma.idea.findUnique({ where: { id: idea.id } });
    expect(stored).toMatchObject({
      status: 'IN_PROGRESS',
      jiraStatus: 'In Progress',
      jiraStatusCategory: 'indeterminate',
      jiraAssignee: 'Remote Person',
      jiraSyncActive: true,
    });
    expect(stored!.startedAt).toBeInstanceOf(Date);
    // The idea NEVER gets an in-app assignee — that is what keeps the grandfathered
    // steps/complete endpoints closed for a Jira-driven idea.
    expect(stored!.assigneeId).toBeNull();

    // THE NULL-ACTOR PIN: the poller's event has NO user, which must round-trip real
    // Mongo (the byUserId column had to become optional for this).
    const startedEvent = (
      await prisma.ideaEvent.findMany({ where: { ideaId: idea.id }, orderBy: { timestamp: 'asc' } })
    )[1];
    expect(startedEvent.type).toBe(EventType.JIRA_STATUS_CHANGED);
    expect(startedEvent.byUserId).toBeNull();
    expect(startedEvent.note).toBe('To Do → In Progress');

    // ...and the API serializes it as byUser: null rather than crashing on the join.
    const detail = await agent.get(`/api/ideas/${idea.id}`);
    expect(detail.status).toBe(200);
    const serialized = detail.body.events.find((e: any) => e.type === 'JIRA_STATUS_CHANGED');
    expect(serialized.byUserId).toBeNull();
    expect(serialized.byUser).toBeNull();
    // The JIRA_CREATED event still carries its human actor (the event-type set
    // partitions the actor).
    const createdEvent = detail.body.events.find((e: any) => e.type === 'JIRA_CREATED');
    expect(createdEvent.byUser.id).toBe(power.id);

    // Tick 3: the issue is resolved successfully.
    await mutateIssue(idea.id, { statusName: 'Done', categoryKey: 'done', resolution: 'Fixed' });
    await runJiraSyncOnce();

    stored = await prisma.idea.findUnique({ where: { id: idea.id } });
    expect(stored).toMatchObject({
      status: 'DONE',
      jiraStatus: 'Done',
      jiraResolution: 'Fixed',
      // A final state stops the polling.
      jiraSyncActive: false,
    });
    expect(stored!.completedAt).toBeInstanceOf(Date);

    // Tick 4: the idea is no longer polled at all.
    const requestsBefore = requests.length;
    await runJiraSyncOnce();
    expect(requests.length).toBe(requestsBefore);
  });

  test('poll: a cancel-list resolution returns the idea to APPROVED and re-dispatch is allowed', async () => {
    const { submitter, power } = await seedActors();
    const idea = await approvedIdea(submitter.id, power.id);
    const agent = await powerAgent();
    await withCsrf(agent.post(`/api/ideas/${idea.id}/jira-task`)).send({});

    // Start the work, then cancel it in Jira.
    await mutateIssue(idea.id, { statusName: 'In Progress', categoryKey: 'indeterminate' });
    await runJiraSyncOnce();
    await mutateIssue(idea.id, { statusName: 'Done', categoryKey: 'done', resolution: "Won't Do" });
    await runJiraSyncOnce();

    const cancelled = await prisma.idea.findUnique({ where: { id: idea.id } });
    expect(cancelled).toMatchObject({
      status: 'APPROVED',
      startedAt: null,
      completedAt: null,
      jiraSyncActive: false,
    });
    const events = await prisma.ideaEvent.findMany({ where: { ideaId: idea.id }, orderBy: { timestamp: 'asc' } });
    const cancelEvent = events[events.length - 1];
    expect(cancelEvent.type).toBe(EventType.JIRA_CANCELLED);
    expect(cancelEvent.byUserId).toBeNull();
    expect(cancelEvent.note).toContain("Won't Do");

    // RE-DISPATCH: the idea is approved again, so a new issue can be created.
    const redispatch = await withCsrf(agent.post(`/api/ideas/${idea.id}/jira-task`)).send({});
    expect(redispatch.status).toBe(200);
    expect(mockIssues.size).toBe(2);
    const after = await prisma.idea.findUnique({ where: { id: idea.id } });
    expect(after!.jiraIssueId).not.toBe(cancelled!.jiraIssueId);
    expect(after!.jiraStatusCategory).toBe('new');
    // The previous cycle's raw fields were cleared by the new dispatch.
    expect(after!.jiraResolution).toBeNull();
  });

  // F11: a search miss alone proves nothing, and even a confirmed 404 needs a second
  // consecutive tick — a permission blip must never mass-cancel ideas.
  test('poll: a deleted issue is only cancelled after TWO consecutive confirmed 404s', async () => {
    const { submitter, power } = await seedActors();
    const idea = await approvedIdea(submitter.id, power.id);
    const agent = await powerAgent();
    await withCsrf(agent.post(`/api/ideas/${idea.id}/jira-task`)).send({});
    await mutateIssue(idea.id, { statusName: 'In Progress', categoryKey: 'indeterminate' });
    await runJiraSyncOnce();

    // A pure SEARCH miss with the issue still readable is treated as search lag.
    await mutateIssue(idea.id, { hiddenFromSearch: true });
    await runJiraSyncOnce();
    let stored = await prisma.idea.findUnique({ where: { id: idea.id } });
    expect(stored!.status).toBe('IN_PROGRESS');
    expect(stored!.jiraMissingCount).toBeNull();

    // Now the issue is really gone. First confirmed 404: only the streak moves.
    await mutateIssue(idea.id, { deleted: true });
    await runJiraSyncOnce();
    stored = await prisma.idea.findUnique({ where: { id: idea.id } });
    expect(stored!.status).toBe('IN_PROGRESS');
    expect(stored!.jiraMissingCount).toBe(1);
    expect(stored!.jiraSyncActive).toBe(true);

    // Second consecutive confirmed 404: the idea returns to APPROVED.
    await runJiraSyncOnce();
    stored = await prisma.idea.findUnique({ where: { id: idea.id } });
    expect(stored).toMatchObject({
      status: 'APPROVED',
      startedAt: null,
      jiraSyncActive: false,
      jiraMissingCount: null,
    });
    const events = await prisma.ideaEvent.findMany({ where: { ideaId: idea.id }, orderBy: { timestamp: 'asc' } });
    const last = events[events.length - 1];
    expect(last.type).toBe(EventType.JIRA_CANCELLED);
    expect(last.byUserId).toBeNull();
    expect(last.note).toContain('deleted or is no longer accessible');
  });

  // Deep-review pin (2026-08-21): the mark-done override races the poller by design
  // — it flips jiraSyncActive off while the remote issue is still open. Two code
  // invariants keep that safe (the poller loads only jiraSyncActive:true ideas, and
  // every poller write is guarded on the same flag); this test pins the OBSERVABLE
  // outcome those invariants exist for: once the override has spoken, no later
  // poller tick may resurrect, re-mirror, or re-notify the idea, whatever keeps
  // happening on the Jira side.
  test('mark-done during an active sync: later poller ticks cannot resurrect the idea', async () => {
    const { submitter, power } = await seedActors();
    const idea = await approvedIdea(submitter.id, power.id);
    const agent = await powerAgent();
    await withCsrf(agent.post(`/api/ideas/${idea.id}/jira-task`)).send({});

    // Work starts in Jira; the idea is IN_PROGRESS with the sync active.
    await mutateIssue(idea.id, { statusName: 'In Progress', categoryKey: 'indeterminate' });
    await runJiraSyncOnce();

    // The override closes the idea while the remote issue is still open.
    const res = await withCsrf(agent.patch(`/api/ideas/${idea.id}/mark-done`)).send({
      note: 'Executed outside Jira — closing it here',
    });
    expect(res.status).toBe(200);

    const closed = await prisma.idea.findUnique({ where: { id: idea.id } });
    expect(closed).toMatchObject({
      status: 'DONE',
      jiraSyncActive: false,
      // The mirror stays as HISTORY — the last state the poller actually saw.
      jiraIssueKey: 'OPS-1',
      jiraStatus: 'In Progress',
    });
    expect(closed!.completedAt).toBeInstanceOf(Date);

    // The override's event carries the acting user and the mandatory reason
    // (unlike the poller's user-less events — the actor partition holds).
    const events = await prisma.ideaEvent.findMany({ where: { ideaId: idea.id }, orderBy: { timestamp: 'asc' } });
    const overrideEvent = events[events.length - 1];
    expect(overrideEvent).toMatchObject({ type: EventType.COMPLETED, byUserId: power.id });
    expect(overrideEvent.note).toBe('Executed outside Jira — closing it here');

    // Jira keeps moving: first a transition that would normally send the idea back
    // to APPROVED, then one that would normally complete it and stamp completedAt.
    const requestsBefore = requests.length;
    await mutateIssue(idea.id, { statusName: 'To Do', categoryKey: 'new' });
    await runJiraSyncOnce();
    await mutateIssue(idea.id, { statusName: 'Done', categoryKey: 'done', resolution: 'Fixed' });
    await runJiraSyncOnce();

    // The idea was not even POLLED (it left the jiraSyncActive:true set)...
    expect(requests.length).toBe(requestsBefore);
    // ...and nothing about it moved: status, mirror, timestamps, timeline.
    const after = await prisma.idea.findUnique({ where: { id: idea.id } });
    expect(after).toMatchObject({
      status: 'DONE',
      jiraSyncActive: false,
      jiraStatus: 'In Progress',
      jiraResolution: null,
    });
    expect(after!.completedAt!.getTime()).toBe(closed!.completedAt!.getTime());
    // @updatedAt is the tripwire: ANY write — even a no-op-looking one — would move it.
    expect(after!.updatedAt.getTime()).toBe(closed!.updatedAt.getTime());
    expect(await prisma.ideaEvent.count({ where: { ideaId: idea.id } })).toBe(events.length);
  });
});

// ---------------------------------------------------------------------------
// The MISSING-vs-NULL pins. These are the reason the explicit-write rule and the
// boot backfill exist, and real Mongo is the only place they can be proven.
// ---------------------------------------------------------------------------
describe('jira missing-vs-null semantics (real Mongo)', () => {
  /** Raw-insert an idea document with NO jira fields at all (a pre-feature doc). */
  async function insertLegacyIdea(submitterId: string, departmentId: string, title: string) {
    await prisma.$runCommandRaw({
      insert: 'ideas',
      documents: [
        {
          title,
          description: 'A sufficiently detailed legacy idea description.',
          benefits: 'Clear and measurable benefits described here.',
          effort: 'LESS_THAN_ONE_DAY',
          status: 'APPROVED',
          tags: [],
          submitterId: { $oid: submitterId },
          departmentId: { $oid: departmentId },
          notifyOnChange: false,
          submittedAt: { $date: '2026-01-01T00:00:00.000Z' },
          approvedAt: { $date: '2026-01-02T00:00:00.000Z' },
          createdAt: { $date: '2026-01-01T00:00:00.000Z' },
          updatedAt: { $date: '2026-01-01T00:00:00.000Z' },
        },
      ],
    });
    const idea = await prisma.idea.findFirst({ where: { title } });
    expect(idea).not.toBeNull();
    return idea!;
  }

  test('a legacy idea (no jira fields) is dispatchable ONLY after the boot backfill', async () => {
    const { submitter, power } = await seedActors();
    const departmentId = await getDefaultDepartmentId();
    const legacy = await insertLegacyIdea(submitter.id, departmentId, 'Legacy idea without jira fields');

    // A missing scalar reads back as null (never a crash).
    expect(legacy.jiraSyncActive).toBeNull();

    const agent = await powerAgent();

    // BEFORE the backfill the atomic claim (`where: { jiraSyncActive: false }`)
    // cannot match the missing field, so the dispatch is refused. This is the exact
    // failure the backfill exists to prevent.
    const before = await withCsrf(agent.post(`/api/ideas/${legacy.id}/jira-task`)).send({});
    expect(before.status).toBe(409);
    expect(mockIssues.size).toBe(0);

    // The boot backfill matches the MISSING field (Prisma's updateMany cannot) and
    // writes the explicit default.
    await ensureIdeaJiraDefaults();
    const backfilled = await prisma.idea.findUnique({ where: { id: legacy.id } });
    expect(backfilled!.jiraSyncActive).toBe(false);

    // Now the very same request succeeds.
    const after = await withCsrf(agent.post(`/api/ideas/${legacy.id}/jira-task`)).send({});
    expect(after.status).toBe(200);
    expect(after.body.jiraIssueKey).toBe('OPS-1');
  });

  test('an abandoned dispatch claim (explicit null issue id, older than 10 minutes) is released by the sweep', async () => {
    const { submitter, power } = await seedActors();
    // Exactly the state the dispatch endpoint writes before calling Jira.
    const idea = await createIdea({
      submitterId: submitter.id,
      approverId: power.id,
      status: IdeaStatus.APPROVED,
      approvedAt: new Date(),
      jiraSyncActive: true,
      jiraIssueId: null,
    });
    // Age the document past the sweep window (updatedAt is @updatedAt, so it has to
    // be set through a raw write).
    await prisma.$runCommandRaw({
      update: 'ideas',
      updates: [
        {
          q: { _id: { $oid: idea.id } },
          u: { $set: { updatedAt: { $date: new Date(Date.now() - 60 * 60 * 1000).toISOString() } } },
        },
      ],
    });

    await runJiraSyncOnce();

    const released = await prisma.idea.findUnique({ where: { id: idea.id } });
    expect(released!.jiraSyncActive).toBe(false);

    // ...and the idea is dispatchable again.
    const agent = await powerAgent();
    const res = await withCsrf(agent.post(`/api/ideas/${idea.id}/jira-task`)).send({});
    expect(res.status).toBe(200);
  });

  test('a fresh dispatch claim is NOT swept (only abandoned ones are)', async () => {
    const { submitter, power } = await seedActors();
    const idea = await createIdea({
      submitterId: submitter.id,
      approverId: power.id,
      status: IdeaStatus.APPROVED,
      jiraSyncActive: true,
      jiraIssueId: null,
    });

    await runJiraSyncOnce();

    const stored = await prisma.idea.findUnique({ where: { id: idea.id } });
    expect(stored!.jiraSyncActive).toBe(true);
  });

  test('an idea document without jira fields is excluded from the /jira-statuses breakdown', async () => {
    const { submitter, power } = await seedActors();
    const departmentId = await getDefaultDepartmentId();
    await insertLegacyIdea(submitter.id, departmentId, 'Legacy idea for the breakdown');
    // A dispatched, mirrored idea alongside it.
    await createIdea({
      submitterId: submitter.id,
      status: IdeaStatus.IN_PROGRESS,
      jiraSyncActive: true,
      jiraIssueId: '10001',
      jiraIssueKey: 'OPS-1',
      jiraStatus: 'In Review',
      jiraStatusCategory: 'indeterminate',
    });
    // ...and an idea that was never dispatched at all (explicit nulls, not missing).
    await createIdea({ submitterId: submitter.id, status: IdeaStatus.APPROVED });

    const admin = await createUser({ email: 'admin@jira.test', password: 'pw', role: Role.ADMIN });
    const agent = newAgent();
    await loginAs(agent, 'admin@jira.test', 'pw');

    const res = await agent.get('/api/reports/jira-statuses');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ status: 'In Review', count: 1 }]);
    void admin;
    void power;
  });
});
