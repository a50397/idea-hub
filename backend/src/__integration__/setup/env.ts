// Runs (via jest `setupFiles`) BEFORE any suite imports the real app.
//
// src/index.ts calls `dotenv.config({ path: '../.env' })` on import, but dotenv
// never overwrites variables that already exist in process.env. The repo-root
// .env holds PRODUCTION-ish values (mongodb://mongodb:..., NODE_ENV=production,
// SSO_ENABLED=true against Keycloak), so we must pin every var the app reads here
// first. index.ts also `process.exit(1)`s outside development when SESSION_SECRET
// is missing, and utils/init-admin.ts exits when no admin exists and
// ADMIN_EMAIL/ADMIN_PASSWORD are unset — both are satisfied below.

export const DEFAULT_TEST_DATABASE_URL =
  'mongodb://localhost:27017/ideahub_itest?replicaSet=rs0&directConnection=true';

process.env.NODE_ENV = 'test';
// Honor a pre-set DATABASE_URL (CI supplies its own, without directConnection).
process.env.DATABASE_URL = process.env.DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET || 'integration-tier-session-secret-deterministic';

// ensureAdminExists() runs on app boot; give it credentials so it provisions a
// boot admin instead of exiting. Suites reset the DB and account for this admin.
process.env.ADMIN_EMAIL = 'itest-boot-admin@example.com';
process.env.ADMIN_PASSWORD = 'itest-boot-admin-password';
process.env.ADMIN_NAME = 'Integration Boot Admin';

// http, not https, so supertest's cookie jar keeps the session cookie.
process.env.COOKIE_SECURE = 'false';
// Ephemeral port for app.listen so re-importing the app per suite never EADDRINUSE.
process.env.BACKEND_PORT = '0';
process.env.FRONTEND_URL = 'http://localhost:5173';

// SSO off by default; the SSO suite turns it on and points it at an in-process
// mock IdP. Pinning it here stops the root .env's Keycloak config from leaking in.
process.env.SSO_ENABLED = 'false';
