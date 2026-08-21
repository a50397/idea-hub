import prisma from '../lib/prisma';

// Ensures every idea document carries an explicit jiraSyncActive flag. The Jira
// fields (see prisma/schema.prisma Idea) were added after the initial release, so
// ideas created before them lack the field entirely. Runs on boot (see index.ts) so
// an existing deployment self-migrates on upgrade with no manual DB step, and is
// idempotent by construction: once every idea has the field this matches nothing,
// which makes it safe to re-run (the integration tier re-invokes it).
//
// WHY THIS IS REQUIRED (not merely belt-and-braces like ensureIdeaNotifyDefaults):
// the dispatch endpoint's atomic claim is
//   updateMany({ where: { id, status: APPROVED, jiraSyncActive: false }, ... })
// and a Prisma+Mongo where-clause does NOT match a *missing* scalar. Without this
// backfill a legacy idea would match zero rows and the dispatch would answer 409
// forever. New ideas get the explicit `jiraSyncActive: false` from the create
// handler, so this covers exactly the pre-feature documents.
export async function ensureIdeaJiraDefaults(): Promise<void> {
  try {
    // Same technique (and same reason) as ensureIdeaNotifyDefaults: Prisma's
    // `updateMany({ where: { jiraSyncActive: null } })` does NOT match a *missing*
    // scalar field. Drop to a native Mongo update, where `{ $exists: false }`
    // matches exactly the documents that predate the field and `$set` writes the
    // explicit not-dispatched default (false). `ideas` is the Idea model's @@map
    // collection name.
    const result = (await prisma.$runCommandRaw({
      update: 'ideas',
      updates: [
        {
          q: { jiraSyncActive: { $exists: false } },
          u: { $set: { jiraSyncActive: false } },
          multi: true,
        },
      ],
    })) as { nModified?: number; n?: number };

    const updated = result.nModified ?? result.n ?? 0;
    if (updated > 0) {
      console.log(`Backfilled jiraSyncActive=false on ${updated} legacy idea(s)`);
    }
  } catch (error) {
    // Best-effort by design, exactly like ensureIdeaNotifyDefaults: this runs after
    // the server is already listening, so exiting would turn a transient DB hiccup
    // into an outage. A failed backfill only leaves legacy ideas un-dispatchable
    // (409) until the next boot re-runs it — never data loss. Log and keep serving.
    console.error('Failed to ensure idea jira defaults (continuing):', error);
  }
}
