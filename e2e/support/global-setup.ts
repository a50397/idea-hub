import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { E2E_DATABASE_URL, E2E_DB_NAME } from './config';

/**
 * Deterministic database state for every run:
 *   1. drop the whole E2E database (removes leftover sessions / steps / ideas),
 *   2. `prisma db push` to recreate collections + indexes,
 *   3. run the real seed to create the known users + ideas.
 *
 * Runs against the E2E DB directly (no backend needed). The seed refuses
 * NODE_ENV=production, so it is invoked with NODE_ENV=development.
 */
export default async function globalSetup(): Promise<void> {
  const backendDir = path.resolve(process.cwd(), 'backend');

  // 1. Wipe.
  const client = new MongoClient(E2E_DATABASE_URL, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    await client.db(E2E_DB_NAME).dropDatabase();
    console.log(`[global-setup] dropped database "${E2E_DB_NAME}"`);
  } finally {
    await client.close();
  }

  const childEnv = { ...process.env, DATABASE_URL: E2E_DATABASE_URL };

  // 2. Push schema (collections + indexes).
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
    cwd: backendDir,
    env: childEnv,
    stdio: 'inherit',
  });

  // 3. Seed known data.
  execFileSync('npx', ['tsx', 'prisma/seed.ts'], {
    cwd: backendDir,
    env: { ...childEnv, NODE_ENV: 'development' },
    stdio: 'inherit',
  });

  console.log('[global-setup] database seeded');
}
