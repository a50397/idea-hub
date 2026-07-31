import prisma from '../lib/prisma';

// Ensures every idea document carries an explicit notifyOnChange flag. The field
// (a per-idea submitter opt-in to lifecycle mail) was added after the initial
// release, so ideas created before it lack the field entirely. Runs on boot (see
// index.ts) so an existing deployment self-migrates on upgrade with no manual DB
// step, and is idempotent by construction: once every idea has the field this
// matches nothing, which makes it safe to re-run (the integration tier re-invokes
// it). Every read path also treats null as false, so this backfill is belt-and-
// braces, not the sole guard.
export async function ensureIdeaNotifyDefaults(): Promise<void> {
  try {
    // Legacy Mongo documents lack the notifyOnChange field entirely, and Prisma's
    // `updateMany({ where: { notifyOnChange: null } })` does NOT match a *missing*
    // scalar field — the same limitation ensureDepartments hits with a missing
    // @db.ObjectId (verified against Mongo). Drop to a native Mongo update, where
    // `{ $exists: false }` matches exactly the documents that predate the field and
    // `$set` writes the strict-opt-out default (false). `ideas` is the Idea model's
    // @@map collection name.
    const result = (await prisma.$runCommandRaw({
      update: 'ideas',
      updates: [
        {
          q: { notifyOnChange: { $exists: false } },
          u: { $set: { notifyOnChange: false } },
          multi: true,
        },
      ],
    })) as { nModified?: number; n?: number };

    const updated = result.nModified ?? result.n ?? 0;
    if (updated > 0) {
      console.log(`Backfilled notifyOnChange=false on ${updated} legacy idea(s)`);
    }
  } catch (error) {
    console.error('Failed to ensure idea notify defaults:', error);
    process.exit(1);
  }
}
