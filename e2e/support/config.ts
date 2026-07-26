import path from 'node:path';

/**
 * Single source of truth for the E2E environment: ports, URLs, seeded
 * credentials, the mock-IdP identity and the isolated E2E database URL.
 *
 * Imported by playwright.config.ts, the global setup and the specs so that the
 * servers, the seeder and the assertions can never drift out of sync.
 */

export const isCI = !!process.env.CI;

export const PORTS = {
  backend: 3001,
  frontend: 5173,
  mockIdp: 8099,
  mongo: 27017,
} as const;

export const FRONTEND_URL = `http://localhost:${PORTS.frontend}`;
export const BACKEND_URL = `http://localhost:${PORTS.backend}`;
export const API_BASE = `${BACKEND_URL}/api`;
export const MOCK_IDP_URL = `http://localhost:${PORTS.mockIdp}`;

export const E2E_DB_NAME = 'ideahub_e2e';

/**
 * Isolated E2E database. Locally the single-node replica set advertises the
 * `mongodb` hostname, so host connections must pin `directConnection=true`;
 * in CI the replica set is initiated with host `localhost:27017`, so discovery
 * resolves and directConnection must be omitted. Overridable via env.
 */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ||
  `mongodb://root:example-dev-password@localhost:${PORTS.mongo}/${E2E_DB_NAME}?replicaSet=rs0&authSource=admin${
    isCI ? '' : '&directConnection=true'
  }`;

/** Seeded local accounts (see backend/prisma/seed.ts). */
export const CREDENTIALS = {
  admin: { email: 'admin@ideahub.com', password: 'admin123', name: 'Admin User' },
  power: { email: 'power@ideahub.com', password: 'power123', name: 'Power User' },
  user: { email: 'john@ideahub.com', password: 'user123', name: 'John Doe' },
  user2: { email: 'jane@ideahub.com', password: 'user123', name: 'Jane Smith' },
} as const;

export type RoleKey = keyof typeof CREDENTIALS;

/**
 * Identity the mock IdP asserts. The role `ideahub-power` maps to POWER_USER
 * via SSO_ROLE_MAP (see backend env in playwright.config.ts) and `org` maps to
 * the user's department.
 */
export const SSO_IDENTITY = {
  email: 'sso.user@example.com',
  name: 'SSO User',
  roles: ['ideahub-power'],
  org: 'QA',
  mappedRole: 'POWER_USER',
} as const;

/** Backend env for the server + globalSetup, with SSO pointed at the mock IdP. */
export const BACKEND_ENV: Record<string, string> = {
  DATABASE_URL: E2E_DATABASE_URL,
  NODE_ENV: 'test',
  SESSION_SECRET: 'e2e-session-secret-not-a-real-secret',
  // AES-256-GCM key for the stored SMTP password (utils/secretbox.ts). A fixed
  // 32-byte hex value keeps the E2E backend deterministic across restarts.
  MAIL_SETTINGS_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  COOKIE_SECURE: 'false',
  BACKEND_PORT: String(PORTS.backend),
  FRONTEND_URL,
  // Playwright starts the backend (webServer plugin) BEFORE globalSetup runs, so
  // on a fresh CI database the backend's ensureAdminExists() fires first. Give it
  // a distinct bootstrap email so it can never collide with the seed's
  // admin@ideahub.com (the throwaway admin is wiped by globalSetup's DB drop);
  // tests always authenticate as the seeded admin.
  ADMIN_EMAIL: 'e2e-bootstrap-admin@ideahub.com',
  ADMIN_PASSWORD: 'e2e-bootstrap-pass',
  ADMIN_NAME: 'E2E Bootstrap Admin',
  SSO_ENABLED: 'true',
  SSO_ISSUER_URL: MOCK_IDP_URL,
  SSO_CLIENT_ID: 'ideahub-e2e',
  SSO_CLIENT_SECRET: 'ideahub-e2e-secret',
  SSO_REDIRECT_URI: `${API_BASE}/auth/sso/callback`,
  SSO_ROLE_MAP: 'ideahub-admin:ADMIN,ideahub-power:POWER_USER,ideahub-user:USER',
  SSO_POST_LOGOUT_REDIRECT_URI: `${FRONTEND_URL}/login`,
};

/** Env consumed by e2e/support/mock-idp.mjs (single source of truth). */
export const MOCK_IDP_ENV: Record<string, string> = {
  MOCK_IDP_PORT: String(PORTS.mockIdp),
  SSO_USER_EMAIL: SSO_IDENTITY.email,
  SSO_USER_NAME: SSO_IDENTITY.name,
  SSO_USER_ROLES: SSO_IDENTITY.roles.join(','),
  SSO_USER_ORG: SSO_IDENTITY.org,
};

/** Per-role auth storage states written by auth.setup.ts. Kept under e2e/ and gitignored. */
export const AUTH_DIR = path.resolve(process.cwd(), 'e2e', '.auth');
export function storageStatePath(role: RoleKey): string {
  return path.join(AUTH_DIR, `${role}.json`);
}
