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

// Grace window applied to candidates' `updatedAt` (see the login-race note in the
// JSDoc below): 15 minutes comfortably outlasts any login flow while staying
// meaningless next to the daily prune cadence.
const DEFAULT_PRUNE_GRACE_MS = 15 * 60 * 1000;

// Candidates are processed in chunks of this many users so that every `$in` this
// module issues (the ideas OR-query, the events query, the sessions `distinct`,
// and the deleteMany itself) stays bounded far below Mongo's 16MB command limit
// no matter how large the SSO population grows. 5,000 ids ≈ a few hundred KB.
const DEFAULT_CANDIDATE_CHUNK_SIZE = 5_000;

// At most this many pruned-candidate emails appear in one log line; the rest
// collapse into a "+X more" suffix so a mass prune cannot emit an unbounded line.
const MAX_LOGGED_PRUNE_EMAILS = 50;

// Evaluate ONE bounded chunk of candidates and delete its orphans. Returns the
// chunk's prunable candidates and how many of them the delete actually removed.
// All safety semantics live here unchanged: only ids from this chunk are ever
// considered, and the deleteMany re-asserts authProvider: 'SSO' (belt-and-braces).
async function pruneCandidateChunk(
  chunk: { id: string; email: string }[],
  graceCutoff: Date | null
): Promise<{ prunable: { id: string; email: string }[]; deleted: number }> {
  const candidateIds = chunk.map((c) => c.id);

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
  const candidateIdSet = new Set(candidateIds);
  const referencedByIdea = new Set<string>();
  for (const idea of referencingIdeas) {
    // Record only candidate ids: a matched idea also names non-candidate (e.g.
    // LOCAL submitter) users, and collecting those would just bloat the set
    // without affecting which candidates are kept.
    if (candidateIdSet.has(idea.submitterId)) referencedByIdea.add(idea.submitterId);
    if (idea.approverId && candidateIdSet.has(idea.approverId)) referencedByIdea.add(idea.approverId);
    if (idea.assigneeId && candidateIdSet.has(idea.assigneeId)) referencedByIdea.add(idea.assigneeId);
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

  const prunable = chunk.filter(
    (c) =>
      !withSession.has(c.id) &&
      !referencedByIdea.has(c.id) &&
      !referencedByEvent.has(c.id)
  );
  if (prunable.length === 0) {
    return { prunable: [], deleted: 0 };
  }

  // CRITICAL SAFETY: re-assert authProvider: 'SSO' in the delete filter itself, in
  // addition to the candidate pre-filtering above. A non-SSO user is structurally
  // unreachable by this delete. The grace cutoff is re-asserted too: a login that
  // bumps updatedAt after candidacy was decided (JIT upsert lands mid-run, session
  // doc not yet persisted) voids the delete for that user atomically.
  const result = await prisma.user.deleteMany({
    where: {
      id: { in: prunable.map((c) => c.id) },
      authProvider: AuthProvider.SSO,
      ...(graceCutoff ? { updatedAt: { lt: graceCutoff } } : {}),
    },
  });

  return { prunable, deleted: result.count };
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
 *   - their last write (updatedAt) is older than the grace window (default 15
 *     minutes; callers may override via { graceMs }, <= 0 disables it — tests do).
 *     The SSO route JIT-upserts the user BEFORE the login session document is
 *     persisted (routes/sso.ts), so a prune racing a first login could otherwise
 *     see a session-less brand-new user and delete them mid-flow. Every SSO login
 *     bumps updatedAt via that upsert, so an in-flight login always sits inside
 *     the window.
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
 * @param options.graceMs grace window in milliseconds (default 15 min); <= 0 disables
 *   it. Non-finite values (NaN/Infinity) fall back to the default rather than
 *   silently disabling or wedging the guard.
 * @param options.chunkSize candidates evaluated per batch (default 5,000), keeping
 *   every `$in` bounded below Mongo's command size limit; tests pass tiny values
 *   to exercise chunk boundaries cheaply. Truncated to an integer >= 1; non-finite
 *   values fall back to the default (a NaN would otherwise make the chunk loop
 *   slice nothing and silently skip pruning).
 * @returns the number of users actually deleted.
 */
export async function pruneOrphanSsoUsers(
  options?: { graceMs?: number; chunkSize?: number }
): Promise<number> {
  const graceMsRaw = options?.graceMs;
  const graceMs =
    typeof graceMsRaw === 'number' && Number.isFinite(graceMsRaw)
      ? graceMsRaw
      : DEFAULT_PRUNE_GRACE_MS;
  const chunkSizeRaw = options?.chunkSize;
  const chunkSize =
    typeof chunkSizeRaw === 'number' && Number.isFinite(chunkSizeRaw)
      ? Math.max(1, Math.trunc(chunkSizeRaw))
      : DEFAULT_CANDIDATE_CHUNK_SIZE;
  // Candidate set: SSO users only. `{ authProvider: 'SSO' }` matches neither null
  // nor a missing field, so LOCAL and legacy (field-absent) users can never be
  // candidates. The grace window additionally excludes anyone written recently —
  // see the login-race note above. The list is deliberately materialized up front
  // (id+email only, ~100 bytes/user — small even at 100k SSO users); what must
  // stay bounded is each COMMAND, which the chunking below handles. Cursor
  // pagination here was considered and skipped as over-engineering: deleting rows
  // while paginating them is subtle, for no practical gain at this scale.
  const graceCutoff = graceMs > 0 ? new Date(Date.now() - graceMs) : null;
  const candidates = await prisma.user.findMany({
    where: {
      authProvider: AuthProvider.SSO,
      ...(graceCutoff ? { updatedAt: { lt: graceCutoff } } : {}),
    },
    select: { id: true, email: true },
  });
  if (candidates.length === 0) {
    return 0;
  }

  let deletedTotal = 0;
  const prunableAll: { id: string; email: string }[] = [];
  // Chunked so every `$in` issued downstream stays bounded regardless of how
  // large the SSO population grows (see DEFAULT_CANDIDATE_CHUNK_SIZE).
  for (let i = 0; i < candidates.length; i += chunkSize) {
    const { prunable, deleted } = await pruneCandidateChunk(
      candidates.slice(i, i + chunkSize),
      graceCutoff
    );
    prunableAll.push(...prunable);
    deletedTotal += deleted;
  }

  if (deletedTotal > 0) {
    // deleteMany reports only counts, so under a concurrent delete they can differ
    // from the candidate list — log both so the line stays truthful. The emails
    // are logged deliberately (approved design: ops needs to see WHO was pruned;
    // mirrors init-admin logging the admin email), capped so the line is bounded.
    const shown = prunableAll
      .slice(0, MAX_LOGGED_PRUNE_EMAILS)
      .map((c) => c.email)
      .join(', ');
    const omitted = prunableAll.length - MAX_LOGGED_PRUNE_EMAILS;
    console.log(
      `Pruned ${deletedTotal} of ${prunableAll.length} orphaned SSO candidate(s): ${shown}${
        omitted > 0 ? `, +${omitted} more` : ''
      }`
    );
  }

  return deletedTotal;
}
