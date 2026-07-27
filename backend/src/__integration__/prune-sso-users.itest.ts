// Automatic pruning of orphaned SSO users, against the REAL DB.
//
// SSO users are JIT-provisioned on login, so deleting an inert one is lossless
// (they re-provision on next login). LOCAL users — and legacy users whose
// authProvider is null/absent — have no IdP and MUST NEVER be deleted by this
// mechanism. These tests drive pruneOrphanSsoUsers() directly (the boot-time and
// interval calls are skipped under NODE_ENV=test; see index.ts) and assert both
// the prune conditions and, critically, the non-deletion of non-SSO accounts.
// Fixtures are written milliseconds before pruning, so tests pass { graceMs: 0 }
// to disable the login-race grace window; the default window has its own test.
import { EventType } from '@prisma/client';
import {
  prisma,
  AuthProvider,
  IdeaStatus,
  waitForBoot,
  resetDb,
  createUser,
  createIdea,
  getSessionDocs,
} from './support/helpers';
import { pruneOrphanSsoUsers } from '../utils/prune-sso-users';

beforeAll(async () => {
  await waitForBoot();
});

beforeEach(async () => {
  // Truncates every collection (users/ideas/events/departments) AND the sessions
  // collection, then re-seeds the default department. Every test starts clean, so
  // fixtures never leak into other tests or suites.
  await resetDb();
});

// Create an SSO-managed user (no password, authProvider SSO, a unique ssoSub) —
// the exact shape the SSO route JIT-provisions.
function createSsoUser(email: string, overrides: Partial<Parameters<typeof createUser>[0]> = {}) {
  return createUser({
    email,
    password: null,
    authProvider: AuthProvider.SSO,
    ssoSub: `sub-${email}`,
    ...overrides,
  });
}

// Insert a session document shaped exactly like the ones the app persists at
// login. The store runs with `stringify: false` (index.ts), so `session` is a
// nested object and `session.userId` is a real queryable path — which is what both
// the admin invalidation idiom and pruneOrphanSsoUsers rely on.
async function insertSessionFor(userId: string, sid = `itest-sess-${userId}`): Promise<void> {
  await prisma.$runCommandRaw({
    insert: 'sessions',
    documents: [
      {
        _id: sid,
        session: {
          cookie: { originalMaxAge: 604800000, httpOnly: true, path: '/', sameSite: 'lax' },
          userId,
        },
        expires: { $date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() },
      },
    ],
  });
}

describe('pruneOrphanSsoUsers (real DB)', () => {
  test('prunes an SSO user with no session, ideas, or events, and returns the count', async () => {
    const orphan = await createSsoUser('orphan@corp.example');

    const pruned = await pruneOrphanSsoUsers({ graceMs: 0 });

    expect(pruned).toBe(1);
    expect(await prisma.user.findUnique({ where: { id: orphan.id } })).toBeNull();
    expect(await prisma.user.count()).toBe(0);
  });

  test('keeps an SSO user who has a persisted session (a single doc counts as active)', async () => {
    const user = await createSsoUser('has-session@corp.example');
    await insertSessionFor(user.id);
    // Sanity: the doc really exists and is readable via the session-read path.
    expect(await getSessionDocs(user.id)).toHaveLength(1);

    const pruned = await pruneOrphanSsoUsers({ graceMs: 0 });

    expect(pruned).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });

  test('keeps an SSO user who is the submitter of an idea', async () => {
    const submitter = await createSsoUser('sso-submitter@corp.example');
    await createIdea({ submitterId: submitter.id });

    const pruned = await pruneOrphanSsoUsers({ graceMs: 0 });

    expect(pruned).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: submitter.id } })).not.toBeNull();
  });

  test('keeps an SSO user who is the approver of an idea', async () => {
    // A LOCAL submitter (never a prune candidate) isolates the approver check.
    const localSubmitter = await createUser({
      email: 'local-sub-approver@corp.example',
      authProvider: AuthProvider.LOCAL,
    });
    const approver = await createSsoUser('sso-approver@corp.example');
    await createIdea({
      submitterId: localSubmitter.id,
      approverId: approver.id,
      status: IdeaStatus.APPROVED,
      approvedAt: new Date(),
    });

    const pruned = await pruneOrphanSsoUsers({ graceMs: 0 });

    expect(pruned).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: approver.id } })).not.toBeNull();
  });

  test('keeps an SSO user who is the assignee of an idea', async () => {
    const localSubmitter = await createUser({
      email: 'local-sub-assignee@corp.example',
      authProvider: AuthProvider.LOCAL,
    });
    const assignee = await createSsoUser('sso-assignee@corp.example');
    await createIdea({
      submitterId: localSubmitter.id,
      assigneeId: assignee.id,
      status: IdeaStatus.IN_PROGRESS,
      startedAt: new Date(),
    });

    const pruned = await pruneOrphanSsoUsers({ graceMs: 0 });

    expect(pruned).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: assignee.id } })).not.toBeNull();
  });

  test('keeps an SSO user who authored an IdeaEvent (byUserId)', async () => {
    // The idea's submitter is LOCAL so the SSO user is referenced ONLY by the event.
    const localSubmitter = await createUser({
      email: 'local-sub-event@corp.example',
      authProvider: AuthProvider.LOCAL,
    });
    const idea = await createIdea({ submitterId: localSubmitter.id });
    const eventer = await createSsoUser('sso-eventer@corp.example');
    await prisma.ideaEvent.create({
      data: { ideaId: idea.id, type: EventType.UPDATED, byUserId: eventer.id },
    });

    const pruned = await pruneOrphanSsoUsers({ graceMs: 0 });

    expect(pruned).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: eventer.id } })).not.toBeNull();
  });

  test('CRITICAL SAFETY: never prunes a LOCAL user or a null/absent-authProvider user, even with nothing attached', async () => {
    const local = await createUser({
      email: 'local-orphan@corp.example',
      authProvider: AuthProvider.LOCAL,
    });
    // No authProvider provided -> the field is absent in Mongo -> reads back as null,
    // exactly like a legacy pre-SSO account.
    const legacy = await createUser({ email: 'legacy-orphan@corp.example' });
    const legacyRow = await prisma.user.findUnique({
      where: { id: legacy.id },
      select: { authProvider: true },
    });
    expect(legacyRow!.authProvider).toBeNull();

    const pruned = await pruneOrphanSsoUsers({ graceMs: 0 });

    expect(pruned).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: local.id } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: legacy.id } })).not.toBeNull();
  });

  test('is idempotent: an immediately repeated run prunes nothing and returns 0', async () => {
    await createSsoUser('idem-a@corp.example');
    await createSsoUser('idem-b@corp.example');

    const first = await pruneOrphanSsoUsers({ graceMs: 0 });
    expect(first).toBe(2);
    const remaining = await prisma.user.count();

    const second = await pruneOrphanSsoUsers({ graceMs: 0 });
    expect(second).toBe(0);
    expect(await prisma.user.count()).toBe(remaining);
  });

  test('in a mixed population, prunes ONLY the orphaned SSO users and returns their exact count', async () => {
    const orphan1 = await createSsoUser('mix-orphan-1@corp.example');
    const orphan2 = await createSsoUser('mix-orphan-2@corp.example');

    const sessionUser = await createSsoUser('mix-session@corp.example');
    await insertSessionFor(sessionUser.id);

    const localUser = await createUser({
      email: 'mix-local@corp.example',
      authProvider: AuthProvider.LOCAL,
    });
    const legacyUser = await createUser({ email: 'mix-legacy@corp.example' });

    const ssoSubmitter = await createSsoUser('mix-sso-submitter@corp.example');
    await createIdea({ submitterId: ssoSubmitter.id });

    const pruned = await pruneOrphanSsoUsers({ graceMs: 0 });

    expect(pruned).toBe(2);
    // The two true orphans are gone.
    expect(await prisma.user.findUnique({ where: { id: orphan1.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: orphan2.id } })).toBeNull();
    // Everyone else survives.
    for (const keep of [sessionUser, localUser, legacyUser, ssoSubmitter]) {
      expect(await prisma.user.findUnique({ where: { id: keep.id } })).not.toBeNull();
    }
  });

  test('keeps a just-provisioned SSO user inside the default grace window (login-race guard)', async () => {
    // Freshly written (updatedAt = now) — exactly what a user mid-first-login looks
    // like before req.session.save persists their session document. The DEFAULT
    // grace window (no graceMs override here) must keep them even though they have
    // no session, ideas, or events yet.
    const midLogin = await createSsoUser('mid-login@corp.example');

    const pruned = await pruneOrphanSsoUsers();

    expect(pruned).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: midLogin.id } })).not.toBeNull();
  });

  test('prunes a long-dormant SSO user under the DEFAULT grace window', async () => {
    // The production path: default grace active AND a candidate genuinely old.
    // Backdate the fixture's updatedAt via a raw command (any Prisma update would
    // re-bump @updatedAt) so it clears the 15-minute window — this also exercises
    // the delete-time updatedAt re-assert with a non-null cutoff.
    const dormant = await createSsoUser('dormant-orphan@corp.example');
    await prisma.$runCommandRaw({
      update: 'users',
      updates: [
        {
          q: { _id: { $oid: dormant.id } },
          u: {
            $set: {
              updatedAt: { $date: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
            },
          },
        },
      ],
    });

    const pruned = await pruneOrphanSsoUsers();

    expect(pruned).toBe(1);
    expect(await prisma.user.findUnique({ where: { id: dormant.id } })).toBeNull();
  });

  test('chunks candidate processing without losing or double-counting users', async () => {
    // 4 SSO candidates processed with chunkSize 2 → the keep/prune decisions and
    // the returned count must be identical to a single-batch run: chunk boundaries
    // split orphans and kept users across batches.
    const orphanA = await createSsoUser('chunk-orphan-a@corp.example');
    const orphanB = await createSsoUser('chunk-orphan-b@corp.example');
    const orphanC = await createSsoUser('chunk-orphan-c@corp.example');
    const sessionUser = await createSsoUser('chunk-session@corp.example');
    await insertSessionFor(sessionUser.id);
    const localUser = await createUser({
      email: 'chunk-local@corp.example',
      authProvider: AuthProvider.LOCAL,
    });

    const pruned = await pruneOrphanSsoUsers({ graceMs: 0, chunkSize: 2 });

    expect(pruned).toBe(3);
    for (const gone of [orphanA, orphanB, orphanC]) {
      expect(await prisma.user.findUnique({ where: { id: gone.id } })).toBeNull();
    }
    expect(await prisma.user.findUnique({ where: { id: sessionUser.id } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: localUser.id } })).not.toBeNull();
  });

  test('sanitizes non-finite options: NaN graceMs/chunkSize fall back to defaults instead of silently no-opping', async () => {
    // Without sanitization a NaN chunkSize makes the loop slice [] and prune
    // nothing, and a NaN graceMs silently disables the login-race guard. With it,
    // both fall back to defaults — so a backdated dormant orphan must be pruned.
    const dormant = await createSsoUser('nan-options-orphan@corp.example');
    await prisma.$runCommandRaw({
      update: 'users',
      updates: [
        {
          q: { _id: { $oid: dormant.id } },
          u: {
            $set: {
              updatedAt: { $date: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
            },
          },
        },
      ],
    });

    const pruned = await pruneOrphanSsoUsers({ graceMs: NaN, chunkSize: NaN });

    expect(pruned).toBe(1);
    expect(await prisma.user.findUnique({ where: { id: dormant.id } })).toBeNull();
  });
});
