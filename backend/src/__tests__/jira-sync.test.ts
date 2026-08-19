// Unit coverage for the Jira status poller (utils/jira-sync.ts):
//   - maybeRunJiraSync(): the due check, the backoff and the re-entrancy latch,
//   - runJiraSyncOnce(): the stale-claim sweep, the bounded batch load, and the FULL
//     transition matrix (category mapping, events, milestone notifications).
//
// Prisma is mocked at the @prisma/client boundary; the two network calls
// (searchJiraIssuesByIds, getJiraIssue) and the notification helper
// (maybeNotifySubmitter) are mocked so every case is deterministic and offline.
//
// The security-relevant invariants pinned here:
//   F3  at most ONE event per idea per tick, and JIRA_STARTED notifies only when
//       startedAt was still null (once per dispatch cycle),
//   F4  <=500 ideas per run, oldest first,
//   F5  notifications carry the CONSTANT actor "Jira" and a null actorUserId — never
//       the remote assignee's display name,
//   F6  a dispatch claim with no issue id older than 10 minutes is released,
//   F11 a missing issue is cancelled only after TWO consecutive CONFIRMED 404s,
//   F13 a 429/5xx parks the poller until the advised deadline,
//   plus the optimistic-write guard: a zero-row update means a stale run, so no
//   event and no notification are produced.
//
// The last section covers the SYNC HEALTH record (lastSyncOk/lastSyncReason/
// lastSyncAt on the settings singleton): what each kind of run reports, and that it
// is persisted on TRANSITION ONLY.

const mockPrisma: Record<string, any> = {
  idea: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  ideaEvent: {
    create: jest.fn(),
  },
  jiraSettings: {
    findUnique: jest.fn(),
    // The health record is written through the settings singleton's upsert.
    upsert: jest.fn(),
  },
};
mockPrisma.$transaction = jest.fn((fn: (tx: any) => Promise<any>) => fn(mockPrisma));

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
  IdeaStatus: {
    SUBMITTED: 'SUBMITTED',
    APPROVED: 'APPROVED',
    IN_PROGRESS: 'IN_PROGRESS',
    DONE: 'DONE',
    REJECTED: 'REJECTED',
  },
  EventType: {
    SUBMITTED: 'SUBMITTED',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    CLAIMED: 'CLAIMED',
    COMPLETED: 'COMPLETED',
    UPDATED: 'UPDATED',
    JIRA_CREATED: 'JIRA_CREATED',
    JIRA_STATUS_CHANGED: 'JIRA_STATUS_CHANGED',
    JIRA_CANCELLED: 'JIRA_CANCELLED',
  },
  Prisma: {},
}));

// Only the network calls are stubbed; the pure helpers stay real.
jest.mock('../utils/jira', () => {
  const actual = jest.requireActual('../utils/jira');
  return { ...actual, searchJiraIssuesByIds: jest.fn(), getJiraIssue: jest.fn() };
});

// The notification fan-out is covered by its own suite; here we assert WHAT the
// poller asks for (event, actor, key).
jest.mock('../utils/lifecycle-notify', () => {
  const actual = jest.requireActual('../utils/lifecycle-notify');
  return { ...actual, maybeNotifySubmitter: jest.fn() };
});

// getJiraSettingsRecord is the poller's read of the CURRENT stored health status
// (what a new outcome is compared against); the singleton key constant is the real
// one, so the upsert is asserted against the same key production uses.
jest.mock('../config/jira', () => ({
  getEffectiveJiraConfig: jest.fn(),
  getJiraSettingsRecord: jest.fn(),
  JIRA_SETTINGS_SINGLETON: 'singleton',
}));

import {
  maybeRunJiraSync,
  runJiraSyncOnce,
  resetJiraSyncState,
  getJiraSyncBackoffUntil,
  shouldRegisterJiraPollTimer,
  jiraPollIntervalOverrideMs,
} from '../utils/jira-sync';
import { searchJiraIssuesByIds, getJiraIssue, type JiraIssueSnapshot } from '../utils/jira';
import { maybeNotifySubmitter } from '../utils/lifecycle-notify';
import {
  getEffectiveJiraConfig,
  getJiraSettingsRecord,
  type EffectiveJiraConfig,
  type JiraSettingsRecord,
} from '../config/jira';

const mockedSearch = jest.mocked(searchJiraIssuesByIds);
const mockedGetIssue = jest.mocked(getJiraIssue);
const mockedNotify = jest.mocked(maybeNotifySubmitter);
const mockedGetConfig = jest.mocked(getEffectiveJiraConfig);
const mockedGetRecord = jest.mocked(getJiraSettingsRecord);

let logSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;

function cfg(overrides: Partial<EffectiveJiraConfig> = {}): EffectiveJiraConfig {
  return {
    enabled: true,
    effectiveEnabled: true,
    baseUrl: 'https://acme.atlassian.net',
    apiBaseUrl: 'https://acme.atlassian.net',
    baseUrlFromEnv: false,
    email: 'tech@corp.example',
    token: 'jira-api-token',
    defaultProjectKey: 'OPS',
    issueTypeName: 'Task',
    pollIntervalMinutes: 5,
    cancelResolutions: ["won't do", 'cancelled', 'duplicate'],
    hasToken: true,
    tokenDecryptable: true,
    ...overrides,
  };
}

/**
 * The stored settings document as the health recorder reads it. Defaults to "no
 * outcome ever recorded" — the state of an installation that has just been
 * configured.
 */
function storedRecord(overrides: Partial<JiraSettingsRecord> = {}): JiraSettingsRecord {
  return {
    enabled: true,
    baseUrl: 'https://acme.atlassian.net',
    cloudId: null,
    email: 'tech@corp.example',
    apiTokenEnc: 'ciphertext',
    defaultProjectKey: 'OPS',
    issueTypeName: 'Task',
    pollIntervalMinutes: 5,
    cancelResolutions: "Won't Do,Cancelled,Duplicate",
    lastSyncOk: null,
    lastSyncReason: null,
    lastSyncAt: null,
    ...overrides,
  };
}

/** The health writes of a run (the settings-singleton upserts). */
function statusWrites(): Array<{ where: Record<string, unknown>; update: Record<string, unknown> }> {
  return mockPrisma.jiraSettings.upsert.mock.calls.map((call: any[]) => call[0]);
}

/** A dispatched idea as the poller selects it (the SYNC_IDEA_SELECT shape). */
function ideaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'idea1',
    title: 'A dispatched idea',
    status: 'APPROVED',
    notifyOnChange: true,
    submitterId: 'submitter1',
    startedAt: null,
    completedAt: null,
    jiraIssueId: '10001',
    jiraIssueKey: 'OPS-1',
    jiraStatus: 'To Do',
    jiraStatusCategory: 'new',
    jiraAssignee: null,
    jiraResolution: null,
    jiraMissingCount: null,
    submitter: { id: 'submitter1', name: 'Sub Mitter', email: 'submitter@example.com' },
    ...overrides,
  };
}

/** A remote snapshot as utils/jira.ts produces it (already sanitized). */
function snapshot(overrides: Partial<JiraIssueSnapshot> = {}): JiraIssueSnapshot {
  return {
    key: 'OPS-1',
    statusName: 'To Do',
    categoryKey: 'new',
    assignee: null,
    resolution: null,
    ...overrides,
  };
}

/** Arrange one run: these ideas are loaded and Jira answers with these snapshots. */
function arrange(ideas: Array<Record<string, unknown>>, issues: Record<string, JiraIssueSnapshot>) {
  mockPrisma.idea.findMany.mockResolvedValue(ideas);
  mockPrisma.idea.updateMany.mockResolvedValue({ count: 1 });
  mockedSearch.mockResolvedValue({ ok: true, issues: new Map(Object.entries(issues)) });
}

/**
 * The idea writes of a run. Call [0] is always the F6 stale-claim SWEEP, so the
 * per-idea writes start at index 1.
 */
function ideaWrites(): Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> {
  return mockPrisma.idea.updateMany.mock.calls.slice(1).map((call: any[]) => call[0]);
}

function eventWrites(): Array<Record<string, unknown>> {
  return mockPrisma.ideaEvent.create.mock.calls.map((call: any[]) => call[0].data);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetJiraSyncState();
  mockedGetConfig.mockResolvedValue(cfg());
  mockedGetRecord.mockResolvedValue(storedRecord());
  mockPrisma.jiraSettings.upsert.mockResolvedValue({});
  mockPrisma.idea.findMany.mockResolvedValue([]);
  mockPrisma.idea.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.ideaEvent.create.mockResolvedValue({});
  delete process.env.JIRA_POLL_INTERVAL_MS;
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  resetJiraSyncState();
});

// ---------------------------------------------------------------------------
// Scheduling: maybeRunJiraSync()
// ---------------------------------------------------------------------------
describe('maybeRunJiraSync — scheduling', () => {
  it('does NO work at all when Jira is not effectively enabled (F13)', async () => {
    mockedGetConfig.mockResolvedValue(cfg({ effectiveEnabled: false }));

    await maybeRunJiraSync();

    expect(mockPrisma.idea.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.idea.updateMany).not.toHaveBeenCalled();
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it('runs when due and SKIPS an immediately following tick (the configured period has not elapsed)', async () => {
    await maybeRunJiraSync();
    expect(mockPrisma.idea.findMany).toHaveBeenCalledTimes(1);

    await maybeRunJiraSync();
    expect(mockPrisma.idea.findMany).toHaveBeenCalledTimes(1);
  });

  it('honors the JIRA_POLL_INTERVAL_MS override as the due period (the e2e knob)', async () => {
    process.env.JIRA_POLL_INTERVAL_MS = '1';
    await maybeRunJiraSync();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await maybeRunJiraSync();

    expect(mockPrisma.idea.findMany).toHaveBeenCalledTimes(2);
  });

  it('parks the poller until the backoff deadline after a 429 (F13)', async () => {
    process.env.JIRA_POLL_INTERVAL_MS = '1';
    mockPrisma.idea.findMany.mockResolvedValue([ideaRow()]);
    mockedSearch.mockResolvedValue({ ok: false, reason: 'rate_limited', retryAfterSeconds: 120 });

    await maybeRunJiraSync();
    expect(mockedSearch).toHaveBeenCalledTimes(1);
    expect(getJiraSyncBackoffUntil()).toBeGreaterThan(Date.now() + 100_000);

    // Even though the (1ms) period has long elapsed, the backoff blocks the tick.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await maybeRunJiraSync();
    expect(mockedSearch).toHaveBeenCalledTimes(1);
  });

  it('never overlaps runs (re-entrancy latch)', async () => {
    process.env.JIRA_POLL_INTERVAL_MS = '1';
    let release: () => void = () => {};
    mockPrisma.idea.findMany.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve([]); })
    );

    const first = maybeRunJiraSync();
    // Let the in-flight run get as far as its (pending) batch load.
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockPrisma.idea.findMany).toHaveBeenCalledTimes(1);

    // A second tick while the first is still in flight must be a no-op.
    await maybeRunJiraSync();
    expect(mockPrisma.idea.findMany).toHaveBeenCalledTimes(1);

    release();
    await first;
  });

  it('never rejects, even when the settings read blows up', async () => {
    mockedGetConfig.mockRejectedValue(new Error('db down'));
    await expect(maybeRunJiraSync()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runJiraSyncOnce: setup, sweep, batch bounds
// ---------------------------------------------------------------------------
describe('runJiraSyncOnce — batch setup', () => {
  it('bails without touching the database when Jira is not effectively enabled', async () => {
    await runJiraSyncOnce(cfg({ effectiveEnabled: false }));
    expect(mockPrisma.idea.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.idea.findMany).not.toHaveBeenCalled();
  });

  it('reads the settings itself when called without a config (the integration entry point)', async () => {
    await runJiraSyncOnce();
    expect(mockedGetConfig).toHaveBeenCalledTimes(1);
  });

  // F6: a claim written by the dispatch endpoint that never got an issue id (the
  // process died between the claim and the create) is released after 10 minutes.
  it('sweeps stale dispatch claims: syncActive + EXPLICIT null issue id + older than 10 minutes', async () => {
    await runJiraSyncOnce(cfg());

    const sweep = mockPrisma.idea.updateMany.mock.calls[0][0];
    expect(sweep.data).toEqual({ jiraSyncActive: false });
    expect(sweep.where.jiraSyncActive).toBe(true);
    expect(sweep.where.jiraIssueId).toBeNull();
    const cutoff = sweep.where.updatedAt.lt as Date;
    const age = Date.now() - cutoff.getTime();
    expect(age).toBeGreaterThanOrEqual(10 * 60 * 1000 - 5_000);
    expect(age).toBeLessThanOrEqual(10 * 60 * 1000 + 5_000);
  });

  it('continues the run when the sweep itself fails (recovery is not the main job)', async () => {
    mockPrisma.idea.updateMany.mockRejectedValueOnce(new Error('sweep failed'));
    await runJiraSyncOnce(cfg());
    expect(mockPrisma.idea.findMany).toHaveBeenCalled();
  });

  // F4: the load is bounded and ordered oldest-first, and the presence filter uses
  // `isSet` — a bare `not: null` would not match a document that predates the field.
  it('loads at most 500 dispatched ideas, oldest jiraLastSyncAt first, using isSet', async () => {
    await runJiraSyncOnce(cfg());

    const load = mockPrisma.idea.findMany.mock.calls[0][0];
    expect(load.take).toBe(500);
    expect(load.orderBy).toEqual({ jiraLastSyncAt: 'asc' });
    expect(load.where.jiraSyncActive).toBe(true);
    expect(load.where.jiraIssueId).toEqual({ isSet: true, not: null });
  });

  it('makes no remote call when nothing is dispatched', async () => {
    mockPrisma.idea.findMany.mockResolvedValue([]);
    await runJiraSyncOnce(cfg());
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it('writes nothing when the search fails (a partial result would look like deletions)', async () => {
    mockPrisma.idea.findMany.mockResolvedValue([ideaRow()]);
    mockedSearch.mockResolvedValue({ ok: false, reason: 'timeout' });

    await runJiraSyncOnce(cfg());

    expect(ideaWrites()).toHaveLength(0);
    expect(mockPrisma.ideaEvent.create).not.toHaveBeenCalled();
    expect(mockedNotify).not.toHaveBeenCalled();
  });

  it('sets the backoff from a 5xx too (no Retry-After needed)', async () => {
    mockPrisma.idea.findMany.mockResolvedValue([ideaRow()]);
    mockedSearch.mockResolvedValue({ ok: false, reason: 'unknown', retryAfterSeconds: 60 });

    await runJiraSyncOnce(cfg());

    expect(getJiraSyncBackoffUntil()).toBeGreaterThan(Date.now() + 50_000);
  });

  it('does NOT back off for a plain transport failure (the next due tick simply retries)', async () => {
    mockPrisma.idea.findMany.mockResolvedValue([ideaRow()]);
    mockedSearch.mockResolvedValue({ ok: false, reason: 'host_not_found' });

    await runJiraSyncOnce(cfg());

    expect(getJiraSyncBackoffUntil()).toBe(0);
  });

  it('keeps going when one idea throws (per-idea isolation)', async () => {
    arrange([ideaRow({ id: 'idea1' }), ideaRow({ id: 'idea2', jiraIssueId: '10002' })], {
      '10001': snapshot({ categoryKey: 'indeterminate', statusName: 'In Progress' }),
      '10002': snapshot({ categoryKey: 'indeterminate', statusName: 'In Progress' }),
    });
    // The first idea's write blows up (the sweep is call #0).
    mockPrisma.idea.updateMany
      .mockResolvedValueOnce({ count: 0 }) // sweep
      .mockRejectedValueOnce(new Error('write failed')) // idea1
      .mockResolvedValueOnce({ count: 1 }); // idea2

    await runJiraSyncOnce(cfg());

    expect(errorSpy).toHaveBeenCalled();
    // idea2 still transitioned.
    expect(eventWrites()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The transition matrix
// ---------------------------------------------------------------------------
describe('runJiraSyncOnce — transition matrix', () => {
  it('no change: bumps jiraLastSyncAt, clears the missing streak, writes NO event and notifies nobody', async () => {
    arrange([ideaRow({ jiraMissingCount: 1 })], { '10001': snapshot() });

    await runJiraSyncOnce(cfg());

    const [write] = ideaWrites();
    expect(write.data).toEqual({ jiraLastSyncAt: expect.any(Date), jiraMissingCount: null });
    expect(mockPrisma.ideaEvent.create).not.toHaveBeenCalled();
    expect(mockedNotify).not.toHaveBeenCalled();
  });

  it('every write is guarded on the exact issue id and an active sync (optimistic concurrency)', async () => {
    arrange([ideaRow()], { '10001': snapshot() });

    await runJiraSyncOnce(cfg());

    expect(ideaWrites()[0].where).toEqual({ id: 'idea1', jiraIssueId: '10001', jiraSyncActive: true });
  });

  it('new -> indeterminate: IN_PROGRESS, startedAt set, one event, JIRA_STARTED notification', async () => {
    arrange([ideaRow()], {
      '10001': snapshot({ statusName: 'In Progress', categoryKey: 'indeterminate' }),
    });

    await runJiraSyncOnce(cfg());

    expect(ideaWrites()[0].data).toMatchObject({
      status: 'IN_PROGRESS',
      startedAt: expect.any(Date),
      jiraStatus: 'In Progress',
      jiraStatusCategory: 'indeterminate',
    });
    expect(eventWrites()).toEqual([
      { ideaId: 'idea1', type: 'JIRA_STATUS_CHANGED', byUserId: null, note: 'To Do → In Progress' },
    ]);
    expect(mockedNotify).toHaveBeenCalledTimes(1);
    expect(mockedNotify.mock.calls[0][0]).toMatchObject({
      event: 'JIRA_STARTED',
      // F5: a constant actor, never the remote assignee's name.
      actorUserId: null,
      actorName: 'Jira',
      jiraKey: 'OPS-1',
    });
  });

  // F3: the started notification is latched on startedAt, which is set once per
  // dispatch cycle — a status flapping in and out of "In Progress" records every
  // transition as an event but notifies only the first time.
  it('new -> indeterminate with startedAt ALREADY set: event but NO second notification (F3 latch)', async () => {
    arrange([ideaRow({ startedAt: new Date('2026-01-01T00:00:00Z') })], {
      '10001': snapshot({ statusName: 'In Progress', categoryKey: 'indeterminate' }),
    });

    await runJiraSyncOnce(cfg());

    expect(ideaWrites()[0].data).not.toHaveProperty('startedAt');
    expect(eventWrites()).toHaveLength(1);
    expect(mockedNotify).not.toHaveBeenCalled();
  });

  it('-> done without a cancel resolution: DONE, completedAt, sync OFF, JIRA_COMPLETED', async () => {
    arrange([ideaRow({ status: 'IN_PROGRESS', jiraStatusCategory: 'indeterminate', jiraStatus: 'In Progress' })], {
      '10001': snapshot({ statusName: 'Done', categoryKey: 'done', resolution: 'Fixed' }),
    });

    await runJiraSyncOnce(cfg());

    expect(ideaWrites()[0].data).toMatchObject({
      status: 'DONE',
      completedAt: expect.any(Date),
      jiraSyncActive: false,
      jiraResolution: 'Fixed',
    });
    expect(eventWrites()[0]).toMatchObject({ type: 'JIRA_STATUS_CHANGED', byUserId: null });
    expect(mockedNotify.mock.calls[0][0]).toMatchObject({ event: 'JIRA_COMPLETED', actorUserId: null });
  });

  it('-> done with NO resolution at all still counts as completed', async () => {
    arrange([ideaRow({ jiraStatusCategory: 'indeterminate' })], {
      '10001': snapshot({ statusName: 'Done', categoryKey: 'done', resolution: null }),
    });

    await runJiraSyncOnce(cfg());

    expect(ideaWrites()[0].data).toMatchObject({ status: 'DONE', jiraSyncActive: false });
    expect(mockedNotify.mock.calls[0][0]).toMatchObject({ event: 'JIRA_COMPLETED' });
  });

  it('keeps an existing completedAt instead of overwriting it', async () => {
    const completedAt = new Date('2026-01-01T00:00:00Z');
    arrange([ideaRow({ completedAt, jiraStatusCategory: 'indeterminate' })], {
      '10001': snapshot({ statusName: 'Done', categoryKey: 'done' }),
    });

    await runJiraSyncOnce(cfg());

    expect(ideaWrites()[0].data).not.toHaveProperty('completedAt');
  });

  it.each(["Won't Do", 'cancelled', 'DUPLICATE'])(
    '-> done with the cancel resolution %s: back to APPROVED, timestamps cleared, sync OFF, JIRA_CANCELLED',
    async (resolution) => {
      arrange(
        [
          ideaRow({
            status: 'IN_PROGRESS',
            startedAt: new Date('2026-01-01T00:00:00Z'),
            jiraStatusCategory: 'indeterminate',
            jiraStatus: 'In Progress',
          }),
        ],
        { '10001': snapshot({ statusName: 'Done', categoryKey: 'done', resolution }) }
      );

      await runJiraSyncOnce(cfg());

      expect(ideaWrites()[0].data).toMatchObject({
        status: 'APPROVED',
        startedAt: null,
        completedAt: null,
        jiraSyncActive: false,
      });
      const event = eventWrites()[0];
      expect(event).toMatchObject({ type: 'JIRA_CANCELLED', byUserId: null });
      expect(String(event.note)).toContain(resolution);
      expect(mockedNotify.mock.calls[0][0]).toMatchObject({ event: 'JIRA_CANCELLED' });
    }
  );

  it('indeterminate -> new: back to APPROVED, startedAt KEPT, sync stays on, NO notification', async () => {
    const startedAt = new Date('2026-01-01T00:00:00Z');
    arrange(
      [ideaRow({ status: 'IN_PROGRESS', startedAt, jiraStatusCategory: 'indeterminate', jiraStatus: 'In Progress' })],
      { '10001': snapshot({ statusName: 'To Do', categoryKey: 'new' }) }
    );

    await runJiraSyncOnce(cfg());

    const { data } = ideaWrites()[0];
    expect(data).toMatchObject({ status: 'APPROVED' });
    expect(data).not.toHaveProperty('startedAt');
    expect(data).not.toHaveProperty('jiraSyncActive');
    expect(eventWrites()).toHaveLength(1);
    expect(mockedNotify).not.toHaveBeenCalled();
  });

  it('a status-NAME change within the same category writes an event but never notifies', async () => {
    arrange([ideaRow({ jiraStatusCategory: 'indeterminate', jiraStatus: 'In Progress' })], {
      '10001': snapshot({ statusName: 'In Review', categoryKey: 'indeterminate' }),
    });

    await runJiraSyncOnce(cfg());

    expect(ideaWrites()[0].data).toMatchObject({ jiraStatus: 'In Review' });
    expect(eventWrites()).toEqual([
      { ideaId: 'idea1', type: 'JIRA_STATUS_CHANGED', byUserId: null, note: 'In Progress → In Review' },
    ]);
    expect(mockedNotify).not.toHaveBeenCalled();
  });

  // Right after dispatch only the CATEGORY is known (the raw name is null), so the
  // first tick that merely learns the name must not write a "- -> To Do" entry under
  // the dispatch event.
  it('the FIRST sighting of the raw status name updates the field WITHOUT an event', async () => {
    arrange([ideaRow({ jiraStatus: null })], { '10001': snapshot({ statusName: 'To Do' }) });

    await runJiraSyncOnce(cfg());

    expect(ideaWrites()[0].data).toMatchObject({ jiraStatus: 'To Do' });
    expect(mockPrisma.ideaEvent.create).not.toHaveBeenCalled();
    expect(mockedNotify).not.toHaveBeenCalled();
  });

  it('a first sighting that ALSO carries a category transition still writes its event', async () => {
    arrange([ideaRow({ jiraStatus: null })], {
      '10001': snapshot({ statusName: 'In Progress', categoryKey: 'indeterminate' }),
    });

    await runJiraSyncOnce(cfg());

    expect(eventWrites()).toEqual([
      { ideaId: 'idea1', type: 'JIRA_STATUS_CHANGED', byUserId: null, note: '- → In Progress' },
    ]);
  });

  it('an assignee-only or resolution-only change updates the field WITHOUT an event', async () => {
    arrange([ideaRow()], { '10001': snapshot({ assignee: 'Remote Person' }) });

    await runJiraSyncOnce(cfg());

    expect(ideaWrites()[0].data).toMatchObject({ jiraAssignee: 'Remote Person' });
    expect(mockPrisma.ideaEvent.create).not.toHaveBeenCalled();
    expect(mockedNotify).not.toHaveBeenCalled();
  });

  it('refreshes the issue KEY when the issue moved project (the numeric id is the stable poll key)', async () => {
    arrange([ideaRow()], { '10001': snapshot({ key: 'DEV-9' }) });

    await runJiraSyncOnce(cfg());

    expect(ideaWrites()[0].data).toMatchObject({ jiraIssueKey: 'DEV-9' });
  });

  it('leaves the canonical status alone when Jira reports no usable category', async () => {
    arrange([ideaRow()], { '10001': snapshot({ statusName: 'Weird', categoryKey: null }) });

    await runJiraSyncOnce(cfg());

    const { data } = ideaWrites()[0];
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('jiraStatusCategory');
    expect(data).toMatchObject({ jiraStatus: 'Weird' });
  });

  it('writes at most ONE event per idea per tick even when several fields changed (F3)', async () => {
    arrange([ideaRow()], {
      '10001': snapshot({
        key: 'DEV-9',
        statusName: 'In Progress',
        categoryKey: 'indeterminate',
        assignee: 'Remote Person',
        resolution: 'Fixed',
      }),
    });

    await runJiraSyncOnce(cfg());

    expect(mockPrisma.ideaEvent.create).toHaveBeenCalledTimes(1);
  });

  // The optimistic guard: a zero-row update means the idea moved on (re-dispatched,
  // finalized, deleted) since this run loaded it.
  it('a STALE run (zero rows updated) writes no event and sends no notification', async () => {
    arrange([ideaRow()], {
      '10001': snapshot({ statusName: 'In Progress', categoryKey: 'indeterminate' }),
    });
    mockPrisma.idea.updateMany.mockResolvedValue({ count: 0 });

    await runJiraSyncOnce(cfg());

    expect(mockPrisma.ideaEvent.create).not.toHaveBeenCalled();
    expect(mockedNotify).not.toHaveBeenCalled();
  });

  it('passes the idea shape the notification needs (opt-in, submitter, title)', async () => {
    arrange([ideaRow()], {
      '10001': snapshot({ statusName: 'In Progress', categoryKey: 'indeterminate' }),
    });

    await runJiraSyncOnce(cfg());

    expect(mockedNotify.mock.calls[0][0].idea).toEqual({
      id: 'idea1',
      title: 'A dispatched idea',
      notifyOnChange: true,
      submitterId: 'submitter1',
      submitter: { id: 'submitter1', name: 'Sub Mitter', email: 'submitter@example.com' },
    });
  });
});

// ---------------------------------------------------------------------------
// F11: an issue missing from the search result
// ---------------------------------------------------------------------------
describe('runJiraSyncOnce — missing issues (F11)', () => {
  it('confirms a search miss with a direct read and treats a FOUND issue as present (search lag)', async () => {
    arrange([ideaRow()], {}); // the search returned nothing for this idea
    mockedGetIssue.mockResolvedValue({
      ok: true,
      found: true,
      issue: snapshot({ statusName: 'In Progress', categoryKey: 'indeterminate' }),
    });

    await runJiraSyncOnce(cfg());

    expect(mockedGetIssue).toHaveBeenCalledWith(expect.anything(), '10001');
    expect(ideaWrites()[0].data).toMatchObject({ status: 'IN_PROGRESS' });
    expect(mockedNotify.mock.calls[0][0]).toMatchObject({ event: 'JIRA_STARTED' });
  });

  it('a FIRST confirmed 404 only increments the streak — no cancellation, no event', async () => {
    arrange([ideaRow()], {});
    mockedGetIssue.mockResolvedValue({ ok: true, found: false });

    await runJiraSyncOnce(cfg());

    expect(ideaWrites()[0].data).toEqual({ jiraLastSyncAt: expect.any(Date), jiraMissingCount: 1 });
    expect(mockPrisma.ideaEvent.create).not.toHaveBeenCalled();
    expect(mockedNotify).not.toHaveBeenCalled();
  });

  it('a SECOND consecutive confirmed 404 cancels: back to APPROVED, sync off, JIRA_CANCELLED', async () => {
    arrange([ideaRow({ status: 'IN_PROGRESS', startedAt: new Date(), jiraMissingCount: 1 })], {});
    mockedGetIssue.mockResolvedValue({ ok: true, found: false });

    await runJiraSyncOnce(cfg());

    expect(ideaWrites()[0].data).toMatchObject({
      status: 'APPROVED',
      startedAt: null,
      completedAt: null,
      jiraSyncActive: false,
      jiraMissingCount: null,
    });
    const event = eventWrites()[0];
    expect(event).toMatchObject({ type: 'JIRA_CANCELLED', byUserId: null });
    expect(String(event.note)).toContain('deleted or is no longer accessible');
    expect(mockedNotify.mock.calls[0][0]).toMatchObject({ event: 'JIRA_CANCELLED' });
  });

  // A 403 (the tech user lost permission) or a 5xx must NEVER be read as deletion:
  // cancelling a whole project's ideas over a permission blip is the failure mode
  // F11 exists to prevent.
  it.each([
    ['a permission failure', { ok: false as const, reason: 'invalid_credentials' as const }],
    ['a transport failure', { ok: false as const, reason: 'timeout' as const }],
  ])('%s during the confirm resets the streak and changes nothing else', async (_label, probe) => {
    arrange([ideaRow({ jiraMissingCount: 1 })], {});
    mockedGetIssue.mockResolvedValue(probe);

    await runJiraSyncOnce(cfg());

    expect(ideaWrites()[0].data).toEqual({ jiraLastSyncAt: expect.any(Date), jiraMissingCount: null });
    expect(mockPrisma.ideaEvent.create).not.toHaveBeenCalled();
    expect(mockedNotify).not.toHaveBeenCalled();
  });

  it('caps the number of deletion-confirm probes per run (a mass permission loss cannot storm Jira)', async () => {
    const ideas = Array.from({ length: 40 }, (_, i) =>
      ideaRow({ id: `idea${i}`, jiraIssueId: String(10000 + i) })
    );
    arrange(ideas, {});
    mockedGetIssue.mockResolvedValue({ ok: true, found: false });

    await runJiraSyncOnce(cfg());

    expect(mockedGetIssue).toHaveBeenCalledTimes(25);
    // The skipped ideas were left completely untouched, so their (old)
    // jiraLastSyncAt keeps them at the front of the next oldest-first batch.
    expect(ideaWrites()).toHaveLength(25);
  });
});

// ---------------------------------------------------------------------------
// Sync health: what a run reports, and the transition-only persistence rule
// ---------------------------------------------------------------------------
describe('sync health record', () => {
  it('a completed run records ok, clearing any reason, on the settings singleton', async () => {
    arrange([ideaRow()], { '10001': snapshot() });

    await runJiraSyncOnce(cfg());

    expect(statusWrites()).toHaveLength(1);
    const [write] = statusWrites();
    expect(write.where).toEqual({ singleton: 'singleton' });
    expect(write.update).toEqual({
      lastSyncOk: true,
      lastSyncReason: null,
      lastSyncAt: expect.any(Date),
    });
  });

  it('a run with nothing dispatched still counts as completed (healthy, no work)', async () => {
    mockPrisma.idea.findMany.mockResolvedValue([]);

    await runJiraSyncOnce(cfg());

    expect(mockedSearch).not.toHaveBeenCalled();
    expect(statusWrites()[0].update).toMatchObject({ lastSyncOk: true, lastSyncReason: null });
  });

  // The aborted-run case: the batch was NOT mirrored, which is exactly what an
  // admin needs to see. The stored reason is the closed code the client produced.
  it.each([
    ['invalid_credentials'],
    ['rate_limited'],
    ['timeout'],
    ['host_not_found'],
    ['tls_error'],
    ['unknown'],
  ] as const)('an aborted run records the failure reason %s', async (reason) => {
    mockPrisma.idea.findMany.mockResolvedValue([ideaRow()]);
    mockedSearch.mockResolvedValue({ ok: false, reason });

    await runJiraSyncOnce(cfg());

    expect(statusWrites()).toHaveLength(1);
    expect(statusWrites()[0].update).toEqual({
      lastSyncOk: false,
      lastSyncReason: reason,
      lastSyncAt: expect.any(Date),
    });
  });

  it('the FIRST failure is written once; an identical repeat writes NOTHING (transition only)', async () => {
    mockPrisma.idea.findMany.mockResolvedValue([ideaRow()]);
    mockedSearch.mockResolvedValue({ ok: false, reason: 'invalid_credentials' });

    await runJiraSyncOnce(cfg());
    expect(statusWrites()).toHaveLength(1);

    // The stored status now IS the outcome the next run produces.
    mockedGetRecord.mockResolvedValue(
      storedRecord({
        lastSyncOk: false,
        lastSyncReason: 'invalid_credentials',
        lastSyncAt: new Date('2026-01-01T00:00:00Z'),
      })
    );

    await runJiraSyncOnce(cfg());

    // Still one write in total: lastSyncAt keeps pointing at when it STARTED failing.
    expect(statusWrites()).toHaveLength(1);
  });

  it('a DIFFERENT failure reason is a transition and is written', async () => {
    mockedGetRecord.mockResolvedValue(
      storedRecord({ lastSyncOk: false, lastSyncReason: 'timeout', lastSyncAt: new Date() })
    );
    mockPrisma.idea.findMany.mockResolvedValue([ideaRow()]);
    mockedSearch.mockResolvedValue({ ok: false, reason: 'invalid_credentials' });

    await runJiraSyncOnce(cfg());

    expect(statusWrites()[0].update).toMatchObject({
      lastSyncOk: false,
      lastSyncReason: 'invalid_credentials',
    });
  });

  it('the first SUCCESS after failures clears the record (ok, reason null, fresh timestamp)', async () => {
    mockedGetRecord.mockResolvedValue(
      storedRecord({
        lastSyncOk: false,
        lastSyncReason: 'invalid_credentials',
        lastSyncAt: new Date('2026-01-01T00:00:00Z'),
      })
    );
    arrange([ideaRow()], { '10001': snapshot() });

    await runJiraSyncOnce(cfg());

    expect(statusWrites()[0].update).toEqual({
      lastSyncOk: true,
      lastSyncReason: null,
      lastSyncAt: expect.any(Date),
    });
  });

  it('a repeated SUCCESS writes nothing', async () => {
    mockedGetRecord.mockResolvedValue(
      storedRecord({ lastSyncOk: true, lastSyncReason: null, lastSyncAt: new Date() })
    );
    arrange([ideaRow()], { '10001': snapshot() });

    await runJiraSyncOnce(cfg());

    expect(mockPrisma.jiraSettings.upsert).not.toHaveBeenCalled();
  });

  it('records NOTHING when the integration is switched off', async () => {
    await runJiraSyncOnce(cfg({ enabled: false, effectiveEnabled: false }));

    expect(mockedGetRecord).not.toHaveBeenCalled();
    expect(mockPrisma.jiraSettings.upsert).not.toHaveBeenCalled();
  });

  it('records NOTHING when enabled but simply not configured yet (no token at all)', async () => {
    await runJiraSyncOnce(
      cfg({ effectiveEnabled: false, token: '', hasToken: false, tokenDecryptable: false })
    );

    expect(mockPrisma.jiraSettings.upsert).not.toHaveBeenCalled();
  });

  // The motivating case: MAIL_SETTINGS_KEY was rotated, so the stored token no
  // longer decrypts. Everything still LOOKS configured (hasToken is true), the
  // poller just silently stops — this is what must not stay invisible.
  it('records config_error when a stored token no longer decrypts (key rotation)', async () => {
    await runJiraSyncOnce(
      cfg({ effectiveEnabled: false, token: '', hasToken: true, tokenDecryptable: false })
    );

    expect(statusWrites()).toHaveLength(1);
    expect(statusWrites()[0].update).toEqual({
      lastSyncOk: false,
      lastSyncReason: 'config_error',
      lastSyncAt: expect.any(Date),
    });
    // No polling happened — the health record is the ONLY thing the run produced.
    expect(mockPrisma.idea.findMany).not.toHaveBeenCalled();
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it('reports the undecryptable token from the TIMER path too, and only on transition', async () => {
    mockedGetConfig.mockResolvedValue(
      cfg({ effectiveEnabled: false, token: '', hasToken: true, tokenDecryptable: false })
    );

    await maybeRunJiraSync();
    expect(statusWrites()[0].update).toMatchObject({ lastSyncReason: 'config_error' });

    mockedGetRecord.mockResolvedValue(
      storedRecord({ lastSyncOk: false, lastSyncReason: 'config_error', lastSyncAt: new Date() })
    );
    await maybeRunJiraSync();

    expect(statusWrites()).toHaveLength(1);
  });

  it('never throws when the health write fails — the run is unaffected', async () => {
    arrange([ideaRow()], {
      '10001': snapshot({ statusName: 'In Progress', categoryKey: 'indeterminate' }),
    });
    mockPrisma.jiraSettings.upsert.mockRejectedValue(new Error('db down'));

    await expect(runJiraSyncOnce(cfg())).resolves.toBeUndefined();

    // The idea was still mirrored and its event written.
    expect(ideaWrites()[0].data).toMatchObject({ status: 'IN_PROGRESS' });
    expect(eventWrites()).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('records nothing when the settings read itself fails (nothing to report about)', async () => {
    mockedGetRecord.mockRejectedValue(new Error('db down'));
    arrange([ideaRow()], { '10001': snapshot() });

    await expect(runJiraSyncOnce(cfg())).resolves.toBeUndefined();

    expect(mockPrisma.jiraSettings.upsert).not.toHaveBeenCalled();
  });

  // A single idea's failure is isolated by design (the batch continues), so it must
  // NOT be reported as an integration failure — only an aborted run is.
  it('one idea failing does not make the run "failing"', async () => {
    arrange([ideaRow({ id: 'idea1' }), ideaRow({ id: 'idea2', jiraIssueId: '10002' })], {
      '10001': snapshot({ categoryKey: 'indeterminate', statusName: 'In Progress' }),
      '10002': snapshot({ categoryKey: 'indeterminate', statusName: 'In Progress' }),
    });
    mockPrisma.idea.updateMany
      .mockResolvedValueOnce({ count: 0 }) // sweep
      .mockRejectedValueOnce(new Error('write failed')) // idea1
      .mockResolvedValueOnce({ count: 1 }); // idea2

    await runJiraSyncOnce(cfg());

    expect(statusWrites()[0].update).toMatchObject({ lastSyncOk: true });
  });

  it('the status write never carries configuration or credential material', async () => {
    mockPrisma.idea.findMany.mockResolvedValue([ideaRow()]);
    mockedSearch.mockResolvedValue({ ok: false, reason: 'invalid_credentials' });

    await runJiraSyncOnce(cfg({ token: 'jira-api-token-secret' }));

    const [write] = statusWrites();
    expect(Object.keys(write.update).sort()).toEqual([
      'lastSyncAt',
      'lastSyncOk',
      'lastSyncReason',
    ]);
    expect(JSON.stringify(write)).not.toContain('jira-api-token-secret');
    expect(JSON.stringify(write)).not.toContain('acme.atlassian.net');
    // Nor may the log line that accompanies a failure carry the token.
    const logged = [...errorSpy.mock.calls, ...warnSpy.mock.calls].flat().join(' ');
    expect(logged).not.toContain('jira-api-token-secret');
  });
});

// ---------------------------------------------------------------------------
// shouldRegisterJiraPollTimer — the production-registration arm (deep-review pin)
// ---------------------------------------------------------------------------
describe('shouldRegisterJiraPollTimer', () => {
  // The four arms of the one-line registration condition. Inverting it is invisible
  // to every suite (unit and integration boot the app under NODE_ENV=test WITHOUT
  // the override, e2e always sets it) while production would silently stop polling —
  // so each arm is pinned explicitly, against an EXPLICIT env object (the function
  // is pure precisely to make this testable).
  it.each<[string, Record<string, string>, boolean]>([
    ['production without the override', { NODE_ENV: 'production' }, true],
    [
      'production WITH the override (still registers; the override itself is ignored)',
      { NODE_ENV: 'production', JIRA_POLL_INTERVAL_MS: '1000' },
      true,
    ],
    ['test without the override', { NODE_ENV: 'test' }, false],
    ['test with a usable override (the e2e enabler)', { NODE_ENV: 'test', JIRA_POLL_INTERVAL_MS: '1000' }, true],
  ])('%s', (_label, env, expected) => {
    expect(shouldRegisterJiraPollTimer(env as NodeJS.ProcessEnv)).toBe(expected);
  });

  it('treats an unusable override as absent under test (NaN, zero, negative, blank)', () => {
    for (const bad of ['soon', '0', '-5', '']) {
      expect(
        shouldRegisterJiraPollTimer({ NODE_ENV: 'test', JIRA_POLL_INTERVAL_MS: bad } as NodeJS.ProcessEnv)
      ).toBe(false);
    }
  });

  it('jiraPollIntervalOverrideMs honors the override ONLY under NODE_ENV=test', () => {
    expect(
      jiraPollIntervalOverrideMs({
        NODE_ENV: 'production',
        JIRA_POLL_INTERVAL_MS: '1000',
      } as NodeJS.ProcessEnv)
    ).toBeNull();
    expect(
      jiraPollIntervalOverrideMs({ NODE_ENV: 'test', JIRA_POLL_INTERVAL_MS: '1000' } as NodeJS.ProcessEnv)
    ).toBe(1000);
  });
});
