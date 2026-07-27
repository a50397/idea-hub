import { AuthProvider } from '@prisma/client';
import prisma from '../lib/prisma';

// Resolve the set of candidate user ids that have at least one document in the
// connect-mongo `sessions` collection.
//
// This mirrors the admin session-invalidation idiom in routes/users.ts, which
// matches sessions by the nested `session.userId` path. That path only exists
// because the store is configured with `stringify: false` (see index.ts): the
// `session` payload is persisted as a nested BSON object, not a JSON string. This
// function relies on that exact contract (the same one the invalidation and its
// regression test depend on).
//
// routes/users.ts reaches the collection through `req.sessionStore.collectionP`,
// but there is no request context at boot / on the interval. So — like the
// integration tier's clearSessions()/getSessionDocs() helpers, and init-departments
// — we go through Prisma's raw Mongo command ($runCommandRaw) against the same
// `sessions` collection and the same `session.userId` path. A single `distinct`
// returns every candidate id that owns at least one session, without the batch
// truncation a `find` cursor could hit.
//
// Conservative by design: ANY matching document (even an expired one) counts as an
// active session and protects the user from pruning.
async function userIdsWithSession(candidateIds: string[]): Promise<Set<string>> {
  const res = (await prisma.$runCommandRaw({
    distinct: 'sessions',
    key: 'session.userId',
    query: { 'session.userId': { $in: candidateIds } },
  })) as unknown as { values?: unknown[] };

  const withSession = new Set<string>();
  for (const value of res?.values ?? []) {
    if (typeof value === 'string') withSession.add(value);
  }
  return withSession;
}

/**
 * Automatic pruning of orphaned SSO users.
 *
 * SSO users are JIT-provisioned on login (routes/sso.ts), so deleting an inert one
 * is lossless: the IdP re-creates them on their next login. A user is pruned only
 * when ALL of the following hold:
 *   - authProvider === 'SSO'
 *   - no session document exists for them (any document — even expired — counts as
 *     active and keeps the user; conservative, mirrors the invalidation idiom)
 *   - they are not the submitter, approver, or assignee of ANY idea
 *   - they authored no IdeaEvent (byUserId)
 *
 * LOCAL users, and legacy users whose `authProvider` is null or absent, have no
 * IdP to re-provision them and MUST NEVER be deleted by this mechanism. That is
 * enforced twice, independently:
 *   1. They can never enter the candidate set: `{ authProvider: 'SSO' }` matches
 *      only documents whose field equals the 'SSO' enum value — never null, never a
 *      missing field.
 *   2. Belt-and-braces: the final deleteMany re-asserts `authProvider: 'SSO'` in
 *      its own filter, so a non-SSO user is structurally unreachable by the delete
 *      even if a non-SSO id somehow reached the prunable list.
 *
 * @returns the number of users actually deleted.
 */
export async function pruneOrphanSsoUsers(): Promise<number> {
  // Candidate set: SSO users only. `{ authProvider: 'SSO' }` matches neither null
  // nor a missing field, so LOCAL and legacy (field-absent) users can never be
  // candidates.
  const candidates = await prisma.user.findMany({
    where: { authProvider: AuthProvider.SSO },
    select: { id: true, email: true },
  });
  if (candidates.length === 0) {
    return 0;
  }

  const candidateIds = candidates.map((c) => c.id);

  // Candidates referenced by ANY idea as submitter, approver, or assignee.
  // Mirrors the association guard in routes/users.ts DELETE.
  const referencingIdeas = await prisma.idea.findMany({
    where: {
      OR: [
        { submitterId: { in: candidateIds } },
        { approverId: { in: candidateIds } },
        { assigneeId: { in: candidateIds } },
      ],
    },
    select: { submitterId: true, approverId: true, assigneeId: true },
  });
  const referencedByIdea = new Set<string>();
  for (const idea of referencingIdeas) {
    referencedByIdea.add(idea.submitterId);
    if (idea.approverId) referencedByIdea.add(idea.approverId);
    if (idea.assigneeId) referencedByIdea.add(idea.assigneeId);
  }

  // Candidates who authored at least one IdeaEvent.
  const events = await prisma.ideaEvent.findMany({
    where: { byUserId: { in: candidateIds } },
    select: { byUserId: true },
    distinct: ['byUserId'],
  });
  const referencedByEvent = new Set(events.map((e) => e.byUserId));

  // Candidates who have at least one persisted session.
  const withSession = await userIdsWithSession(candidateIds);

  const prunable = candidates.filter(
    (c) =>
      !withSession.has(c.id) &&
      !referencedByIdea.has(c.id) &&
      !referencedByEvent.has(c.id)
  );
  if (prunable.length === 0) {
    return 0;
  }

  const prunableIds = prunable.map((c) => c.id);

  // CRITICAL SAFETY: re-assert authProvider: 'SSO' in the delete filter itself, in
  // addition to the candidate pre-filtering above. A non-SSO user is structurally
  // unreachable by this delete.
  const result = await prisma.user.deleteMany({
    where: { id: { in: prunableIds }, authProvider: AuthProvider.SSO },
  });

  if (result.count > 0) {
    console.log(
      `Pruned ${result.count} orphaned SSO user(s): ${prunable.map((c) => c.email).join(', ')}`
    );
  }

  return result.count;
}
