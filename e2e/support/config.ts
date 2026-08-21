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
  mockJira: 8098,
  mongo: 27017,
} as const;

export const FRONTEND_URL = `http://localhost:${PORTS.frontend}`;
export const BACKEND_URL = `http://localhost:${PORTS.backend}`;
export const API_BASE = `${BACKEND_URL}/api`;
export const MOCK_IDP_URL = `http://localhost:${PORTS.mockIdp}`;
export const MOCK_JIRA_URL = `http://localhost:${PORTS.mockJira}`;

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

/**
 * The Basic-auth credential (Jira account email + API token) every e2e spec that
 * configures Jira settings (admin UI or the API) must use. support/mock-jira.mjs is
 * started with the SAME pair via MOCK_JIRA_ENV below and rejects any other
 * credential with a 401, which is what turns "the real UI flow succeeds" into an
 * implicit end-to-end proof that the backend sent the exact Basic header the admin
 * configured.
 */
export const MOCK_JIRA_IDENTITY = {
  email: 'jira-bot@ideahub.example',
  apiToken: 'e2e-mock-jira-api-token',
} as const;

/** The project key mock-jira.mjs's fixed project catalog always includes. */
export const MOCK_JIRA_PROJECT_KEY = 'OPS';

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
  // The backend also loads the repo-root .env via dotenv, which fills in any
  // variable not set here (dotenv never overrides, but it does fill gaps). Pin
  // every SSO knob the backend consults so a developer's local IdP config
  // (e.g. the DIAM SSO_ROLES_CLAIM=diam:roles) can never leak into the e2e
  // backend and silently change claim extraction or UI behavior.
  SSO_SCOPE: 'openid profile email',
  SSO_ROLES_CLAIM: 'roles',
  SSO_ORG_CLAIM: 'org',
  SSO_EMAIL_CLAIM: 'email',
  SSO_NAME_CLAIM: 'name',
  SSO_SHOW_LOGOUT: 'false',
  // Black-hole the Webex API so no e2e flow (specs enable the Webex channel to
  // test toggle visibility) can ever reach the real cloud; sends are best-effort
  // and fail instantly on this dead local port. Pinned for the same reason as
  // the SSO knobs above: a developer's root .env must not leak a real URL in.
  WEBEX_API_BASE_URL: 'http://127.0.0.1:9',
  // The Jira test/proxy override (security review F7 — WEBEX_API_BASE_URL
  // precedent): wins over the DB-stored base URL for BOTH outbound calls and the
  // browse URL, and is the only way a plain-http target (our mock) is ever
  // accepted. The DB-stored baseUrl each spec saves through the UI/API must still
  // be a valid https, non-IP, non-localhost placeholder — this override is what
  // actually carries every request to support/mock-jira.mjs.
  JIRA_API_BASE_URL: MOCK_JIRA_URL,
  // Also the e2e enabler for the poll timer under NODE_ENV=test (see index.ts) —
  // without it the poller never registers at all. 1s keeps status-transition
  // assertions fast without hot-looping.
  JIRA_POLL_INTERVAL_MS: '1000',
};

/** Env consumed by e2e/support/mock-idp.mjs (single source of truth). */
export const MOCK_IDP_ENV: Record<string, string> = {
  MOCK_IDP_PORT: String(PORTS.mockIdp),
  SSO_USER_EMAIL: SSO_IDENTITY.email,
  SSO_USER_NAME: SSO_IDENTITY.name,
  SSO_USER_ROLES: SSO_IDENTITY.roles.join(','),
  SSO_USER_ORG: SSO_IDENTITY.org,
};

/** Env consumed by e2e/support/mock-jira.mjs (single source of truth). */
export const MOCK_JIRA_ENV: Record<string, string> = {
  MOCK_JIRA_PORT: String(PORTS.mockJira),
  MOCK_JIRA_EMAIL: MOCK_JIRA_IDENTITY.email,
  MOCK_JIRA_API_TOKEN: MOCK_JIRA_IDENTITY.apiToken,
};

/** Per-role auth storage states written by auth.setup.ts. Kept under e2e/ and gitignored. */
export const AUTH_DIR = path.resolve(process.cwd(), 'e2e', '.auth');
export function storageStatePath(role: RoleKey): string {
  return path.join(AUTH_DIR, `${role}.json`);
}
