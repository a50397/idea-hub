// Shared support for the real-database integration tier.
//
// Importing this module boots the REAL app (src/index.ts): it opens the
// connect-mongo session store, connects Prisma, and — inside the app.listen
// callback — runs ensureAdminExists(). Each suite that imports it therefore must
// call waitForBoot() once before touching the DB (see below).
import request from 'supertest';
import bcrypt from 'bcrypt';
import { Role, AuthProvider, IdeaStatus, Effort } from '@prisma/client';
import app, { bootWritesComplete } from '../../index';
import prisma from '../../lib/prisma';
import { ensureDepartments } from '../../utils/init-departments';
import { encrypt } from '../../utils/secretbox';

export { app, prisma, Role, AuthProvider, IdeaStatus, Effort, ensureDepartments };

// The real app enforces CSRF: state-changing requests must carry this header.
export const XSRF_HEADER = 'X-Requested-With';
export const XSRF_VALUE = 'XMLHttpRequest';

// Adds the CSRF header to any supertest request builder (POST/PATCH/DELETE).
export function withCsrf<T extends { set(field: string, value: string): T }>(req: T): T {
  return req.set(XSRF_HEADER, XSRF_VALUE);
}

export function newAgent() {
  return request.agent(app);
}

export function loginAs(
  agent: ReturnType<typeof request.agent>,
  email: string,
  password = 'password123'
) {
  return withCsrf(agent.post('/api/auth/login')).send({ email, password });
}

// index.ts runs its boot-time database writes asynchronously in the app.listen
// callback on import: the admin seed, the department seed and the two missing-field
// backfills (notifyOnChange, jiraSyncActive). Every one of them must have SETTLED
// before a suite wipes and seeds the database, otherwise a late boot write lands in
// the middle of a suite's fixtures — re-creating a department resetDb just deleted,
// or backfilling a document a test deliberately left field-less.
//
// `bootWritesComplete` (exported by index.ts) is the authoritative signal; the admin
// poll is kept as a bounded, diagnosable fallback in case the boot rejected before
// writing anything (the promise still resolves — it is settled in a `finally`).
export async function waitForBoot(): Promise<void> {
  await bootWritesComplete;
  for (let i = 0; i < 200; i++) {
    if ((await prisma.user.count({ where: { role: Role.ADMIN } })) > 0) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('waitForBoot: boot admin was never created (is Mongo reachable?)');
}

// Truncate every collection (documents only — the unique indexes created by
// `prisma db push` survive, which is what the unique-index suite relies on).
export async function resetDb(): Promise<void> {
  await prisma.ideaEvent.deleteMany({});
  await prisma.ideaStep.deleteMany({});
  await prisma.idea.deleteMany({});
  await prisma.department.deleteMany({});
  await prisma.user.deleteMany({});
  // The singleton mail settings document: clear it so every suite starts with mail
  // disabled (absent doc = defaults). Without this, a suite that enables mail could
  // leak an enabled/misconfigured relay into another suite's idea-creation path.
  await prisma.mailSettings.deleteMany({});
  // The singleton Webex settings document: same reasoning as mail — idea creation now
  // fans out Webex DMs guarded on the effective config, so a suite that enables Webex
  // must not leak an enabled channel into another suite's idea-creation path.
  await prisma.webexSettings.deleteMany({});
  // The singleton Jira settings document: same reasoning again, and with more teeth —
  // an enabled Jira channel leaking into another suite would make the poller and the
  // dispatch endpoint reach for a (nonexistent) Jira host.
  await prisma.jiraSettings.deleteMany({});
  // Recreate the default department so every test starts from a valid target
  // (mirrors the boot seed; idempotent by construction).
  await ensureDepartments();
  await clearSessions();
}

// Save the singleton Jira settings document the way the admin PUT route would, using
// the REAL secretbox so the stored token is genuine ciphertext. Every field has a
// working default, so a suite only states what it cares about. NOTE: `baseUrl` here is
// the DATABASE value — a suite that points the client at an in-process mock Jira sets
// the JIRA_API_BASE_URL environment override instead (it wins over this value, and it
// is the only way to reach a plain-http target).
export async function setJiraSettings(overrides: Partial<{
  enabled: boolean;
  baseUrl: string;
  email: string;
  apiToken: string | null;
  defaultProjectKey: string;
  issueTypeName: string;
  pollIntervalMinutes: number;
  cancelResolutions: string;
}> = {}) {
  const values = {
    enabled: overrides.enabled ?? true,
    baseUrl: overrides.baseUrl ?? 'https://jira.itest.example',
    email: overrides.email ?? 'tech@itest.example',
    apiTokenEnc:
      overrides.apiToken === null ? '' : encrypt(overrides.apiToken ?? 'itest-jira-token'),
    defaultProjectKey: overrides.defaultProjectKey ?? 'OPS',
    issueTypeName: overrides.issueTypeName ?? 'Task',
    pollIntervalMinutes: overrides.pollIntervalMinutes ?? 5,
    cancelResolutions: overrides.cancelResolutions ?? "Won't Do,Cancelled,Duplicate",
  };
  return prisma.jiraSettings.upsert({
    where: { singleton: 'singleton' },
    create: values,
    update: values,
  });
}

// Resolve the current default department id (first by order, tie-break name).
// resetDb guarantees the seeded default exists, so this is safe post-reset.
export async function getDefaultDepartmentId(): Promise<string> {
  const first = await prisma.department.findFirst({
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
  });
  if (!first) {
    throw new Error('getDefaultDepartmentId: no departments exist (did resetDb run?)');
  }
  return first.id;
}

// The connect-mongo `sessions` collection is not a Prisma model.
export async function clearSessions(): Promise<void> {
  await prisma.$runCommandRaw({ delete: 'sessions', deletes: [{ q: {}, limit: 0 }] });
}

// Raw read of the connect-mongo `sessions` collection. connect-mongo (with the
// app's default config) stores `session` as a JSON string, so we parse it to
// filter by userId.
export async function getSessionDocs(userId?: string): Promise<Array<Record<string, unknown>>> {
  const res = (await prisma.$runCommandRaw({ find: 'sessions', filter: {} })) as any;
  const docs: Array<Record<string, unknown>> = res?.cursor?.firstBatch ?? [];
  if (!userId) return docs;
  return docs.filter((d) => {
    const raw = (d as any).session;
    try {
      const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return s?.userId === userId;
    } catch {
      return false;
    }
  });
}

export async function listIndexes(collection: string): Promise<any[]> {
  const res = (await prisma.$runCommandRaw({ listIndexes: collection })) as any;
  return res?.cursor?.firstBatch ?? [];
}

export interface CreateUserInput {
  email: string;
  name?: string;
  /** Plain password to hash; pass `null` for an SSO-style account (no password). */
  password?: string | null;
  role?: Role;
  authProvider?: AuthProvider;
  ssoSub?: string;
  department?: string;
}

export async function createUser(input: CreateUserInput) {
  const passwordHash =
    input.password === null ? null : await bcrypt.hash(input.password ?? 'password123', 4);
  return prisma.user.create({
    data: {
      name: input.name ?? 'Test User',
      email: input.email,
      passwordHash,
      role: input.role ?? Role.USER,
      ...(input.authProvider ? { authProvider: input.authProvider } : {}),
      ...(input.ssoSub ? { ssoSub: input.ssoSub } : {}),
      ...(input.department ? { department: input.department } : {}),
    },
  });
}

export interface CreateIdeaInput {
  submitterId: string;
  departmentId?: string;
  title?: string;
  description?: string;
  benefits?: string;
  effort?: Effort;
  status?: IdeaStatus;
  tags?: string[];
  approverId?: string;
  assigneeId?: string;
  submittedAt?: Date;
  approvedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  rejectedAt?: Date;
  // Jira mirror fields. `jiraSyncActive` defaults to an EXPLICIT false (exactly what
  // POST /api/ideas writes) so a fixture idea is dispatchable: the dispatch claim
  // matches `jiraSyncActive: false`, and a Prisma+Mongo where-clause does not match a
  // missing scalar.
  //
  // This builder can NOT produce a document that LACKS a jira field: it goes through
  // Prisma, and `jiraSyncActive` is written unconditionally (`?? false`, so even an
  // explicit null/undefined becomes false). The missing-field fixture — the one the
  // boot backfill and the missing-vs-null pins are about — is built by raw-inserting
  // the document with `prisma.$runCommandRaw`; see insertLegacyIdea() in
  // jira-lifecycle.itest.ts. `jiraIssueId: null` is the one meaningful NULL here (it
  // is exactly what the dispatch claim writes) and is passed through as given.
  notifyOnChange?: boolean;
  jiraSyncActive?: boolean;
  jiraIssueId?: string | null;
  jiraIssueKey?: string;
  jiraStatus?: string;
  jiraStatusCategory?: string;
  jiraAssignee?: string;
  jiraResolution?: string;
  jiraLastSyncAt?: Date;
  jiraMissingCount?: number;
}

export async function createIdea(input: CreateIdeaInput) {
  // Resolve the default department when the caller does not pin one, so direct
  // fixtures still satisfy the API-layer required-department invariant.
  const departmentId = input.departmentId ?? (await getDefaultDepartmentId());
  return prisma.idea.create({
    data: {
      title: input.title ?? 'A valid idea title',
      description: input.description ?? 'A sufficiently detailed idea description.',
      benefits: input.benefits ?? 'Clear and measurable benefits described here.',
      effort: input.effort ?? Effort.LESS_THAN_ONE_DAY,
      status: input.status ?? IdeaStatus.SUBMITTED,
      tags: input.tags ?? [],
      submitterId: input.submitterId,
      departmentId,
      ...(input.approverId ? { approverId: input.approverId } : {}),
      ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
      ...(input.submittedAt ? { submittedAt: input.submittedAt } : {}),
      ...(input.approvedAt ? { approvedAt: input.approvedAt } : {}),
      ...(input.startedAt ? { startedAt: input.startedAt } : {}),
      ...(input.completedAt ? { completedAt: input.completedAt } : {}),
      ...(input.rejectedAt ? { rejectedAt: input.rejectedAt } : {}),
      ...(input.notifyOnChange !== undefined ? { notifyOnChange: input.notifyOnChange } : {}),
      // Explicit not-dispatched default (see CreateIdeaInput above).
      jiraSyncActive: input.jiraSyncActive ?? false,
      // `jiraIssueId: null` is meaningful (it is what the dispatch claim writes), so
      // it is passed through when explicitly given.
      ...(input.jiraIssueId !== undefined ? { jiraIssueId: input.jiraIssueId } : {}),
      ...(input.jiraIssueKey !== undefined ? { jiraIssueKey: input.jiraIssueKey } : {}),
      ...(input.jiraStatus !== undefined ? { jiraStatus: input.jiraStatus } : {}),
      ...(input.jiraStatusCategory !== undefined ? { jiraStatusCategory: input.jiraStatusCategory } : {}),
      ...(input.jiraAssignee !== undefined ? { jiraAssignee: input.jiraAssignee } : {}),
      ...(input.jiraResolution !== undefined ? { jiraResolution: input.jiraResolution } : {}),
      ...(input.jiraLastSyncAt !== undefined ? { jiraLastSyncAt: input.jiraLastSyncAt } : {}),
      ...(input.jiraMissingCount !== undefined ? { jiraMissingCount: input.jiraMissingCount } : {}),
    },
  });
}

// A payload that satisfies createIdeaSchema (title>=5, description>=10,
// benefits>=10, and the now-required departmentId). Stays synchronous: the caller
// resolves the id (e.g. via getDefaultDepartmentId) and passes it in.
export function validIdeaPayload(departmentId: string, overrides: Record<string, unknown> = {}) {
  return {
    title: 'Improve the coffee situation',
    description: 'We should switch to a better coffee supplier for the office.',
    benefits: 'Happier, more caffeinated and productive engineers.',
    effort: Effort.LESS_THAN_ONE_DAY,
    tags: ['office', 'perks'],
    departmentId,
    ...overrides,
  };
}
