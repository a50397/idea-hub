// Real-database integration tier.
//
// Unlike jest.config.js (the fast, fully-mocked unit tier) this config boots the
// REAL Express app (src/index.ts) against a REAL Prisma + MongoDB replica set and
// the REAL connect-mongo session store. It is intentionally NOT picked up by the
// default `npm test` run: the default testMatch is
//   ['**/__tests__/**/*.ts', '**/*.test.ts']
// and these files live in src/__integration__/**/*.itest.ts (note: `.itest.ts`,
// which does not match `*.test.ts`).
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__integration__/**/*.itest.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    // Use the integration tsconfig so the .itest.ts files (excluded from the
    // production tsconfig) are still type-checked while running.
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.integration.json' }],
  },
  // A single shared database — run suites serially so they never race on it.
  maxWorkers: 1,
  testTimeout: 30000,
  // Sync the schema + real indexes (unique email index, etc.) once before the run.
  globalSetup: '<rootDir>/src/__integration__/setup/globalSetup.ts',
  // Set every env var the real app reads BEFORE any suite imports it.
  setupFiles: ['<rootDir>/src/__integration__/setup/env.ts'],
  // The real app leaves long-lived handles open on purpose (the http listener
  // from app.listen, the connect-mongo client, the Prisma client). Force a clean
  // exit rather than hang after the last suite.
  forceExit: true,
};
