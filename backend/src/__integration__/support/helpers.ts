// Shared support for the real-database integration tier.
//
// Importing this module boots the REAL app (src/index.ts): it opens the
// connect-mongo session store, connects Prisma, and — inside the app.listen
// callback — runs ensureAdminExists(). Each suite that imports it therefore must
// call waitForBoot() once before touching the DB (see below).
import request from 'supertest';
import bcrypt from 'bcrypt';
import { Role, AuthProvider, IdeaStatus, Effort } from '@prisma/client';
import app from '../../index';
import prisma from '../../lib/prisma';
import { ensureDepartments } from '../../utils/init-departments';

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

// index.ts runs ensureAdminExists() asynchronously in the app.listen callback on
// import. Wait for it to settle (an ADMIN now exists) so the boot write never
// races with per-suite DB cleanup. Once an admin is visible, ensureAdminExists()
// has no pending writes left.
export async function waitForBoot(): Promise<void> {
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
  // Recreate the default department so every test starts from a valid target
  // (mirrors the boot seed; idempotent by construction).
  await ensureDepartments();
  await clearSessions();
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
