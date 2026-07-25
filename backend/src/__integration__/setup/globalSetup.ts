// Jest globalSetup: sync the Prisma schema (collections + real indexes, notably
// the unique index on users.email) into the test database once before the run.
//
// This runs in the Jest parent process, BEFORE setupFiles/env.ts execute in the
// workers, so it computes DATABASE_URL itself (same default as env.ts). CI sets
// its own DATABASE_URL (without directConnection).
import { execSync } from 'child_process';
import path from 'path';
import { DEFAULT_TEST_DATABASE_URL } from './env';

export default async function globalSetup(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
  const backendDir = path.resolve(__dirname, '../../..'); // .../backend

  execSync('npx prisma db push --skip-generate', {
    cwd: backendDir,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}
