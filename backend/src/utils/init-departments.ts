import prisma from '../lib/prisma';

// Ensures the app always has at least one department and that every idea targets
// one. Runs on boot (see index.ts) and is idempotent by construction so it is
// safe to re-run (the integration tier re-invokes it after wiping the DB).
export async function ensureDepartments(): Promise<void> {
  try {
    const count = await prisma.department.count();

    if (count === 0) {
      try {
        await prisma.department.create({
          data: { name: 'Všeobecné', order: 0 },
        });
        console.log('Default department created: Všeobecné');
      } catch (error) {
        // A concurrent boot/reset may have inserted the default first; the unique
        // name index then rejects this one with P2002. The default exists either
        // way, so treat that as success and only rethrow genuine failures.
        if (!(error && typeof error === 'object' && (error as { code?: string }).code === 'P2002')) {
          throw error;
        }
      }
    }

    // Backfill legacy ideas that predate departments: assign them the first
    // department (by order, tie-break name). Once every idea has a departmentId
    // this matches nothing, which is what makes the whole routine idempotent.
    const first = await prisma.department.findFirst({
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });

    if (first) {
      // Legacy Mongo documents lack the departmentId field entirely, and Prisma's
      // `updateMany({ where: { departmentId: null } })` does NOT match a *missing*
      // @db.ObjectId field (verified against Mongo — it matches 0 such docs). Drop
      // to a native Mongo update, where `{ field: null }` matches both missing and
      // explicit-null documents and `$oid` writes a real ObjectId.
      await prisma.$runCommandRaw({
        update: 'ideas',
        updates: [
          {
            q: { departmentId: null },
            u: { $set: { departmentId: { $oid: first.id } } },
            multi: true,
          },
        ],
      });
    }
  } catch (error) {
    console.error('Failed to ensure departments exist:', error);
    process.exit(1);
  }
}
