// SSO / OIDC configuration.
//
// Every value is read lazily from process.env at call time (never cached at
// module load) so that tests can set SSO_* variables before the first request
// and so that the deployment can be reconfigured without code changes.
//
// App roles are handled as plain string literals ('USER' | 'POWER_USER' |
// 'ADMIN') on purpose: we deliberately avoid importing the Prisma `Role` /
// `AuthProvider` enums as runtime values so that per-file Jest mock factories
// for '@prisma/client' remain valid.

export type AppRole = 'USER' | 'POWER_USER' | 'ADMIN';

// Higher number == higher privilege. Used to pick the strongest mapped role.
const ROLE_PRIORITY: Record<AppRole, number> = {
  USER: 0,
  POWER_USER: 1,
  ADMIN: 2,
};

function isAppRole(value: string): value is AppRole {
  return value === 'USER' || value === 'POWER_USER' || value === 'ADMIN';
}

export function isSsoEnabled(): boolean {
  return process.env.SSO_ENABLED === 'true';
}

/**
 * SSO sessions are IAM-owned, so the in-app logout button is hidden for SSO
 * users by default. SSO_SHOW_LOGOUT=true re-exposes it; the existing logout
 * flow then performs RP-initiated logout at the IdP.
 */
export function isSsoLogoutVisible(): boolean {
  return process.env.SSO_SHOW_LOGOUT === 'true';
}

export interface SsoConfig {
  enabled: boolean;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
  rolesClaim: string;
  orgClaim: string;
  emailClaim: string;
  nameClaim: string;
  postLogoutRedirectUri: string;
}

export function getSsoConfig(): SsoConfig {
  return {
    enabled: isSsoEnabled(),
    issuerUrl: process.env.SSO_ISSUER_URL || '',
    clientId: process.env.SSO_CLIENT_ID || '',
    clientSecret: process.env.SSO_CLIENT_SECRET || '',
    redirectUri: process.env.SSO_REDIRECT_URI || '',
    scope: process.env.SSO_SCOPE || 'openid profile email',
    rolesClaim: process.env.SSO_ROLES_CLAIM || 'roles',
    orgClaim: process.env.SSO_ORG_CLAIM || 'org',
    emailClaim: process.env.SSO_EMAIL_CLAIM || 'email',
    nameClaim: process.env.SSO_NAME_CLAIM || 'name',
    // Where the IdP returns the browser after it ends the SSO session
    // (post_logout_redirect_uri for RP-initiated logout). Defaults to the
    // frontend login page.
    postLogoutRedirectUri:
      process.env.SSO_POST_LOGOUT_REDIRECT_URI || `${process.env.FRONTEND_URL || ''}/login`,
  };
}

/**
 * Parse SSO_ROLE_MAP ('iam-role:ADMIN,other-role:POWER_USER').
 * The app-role side is validated against USER|POWER_USER|ADMIN and any invalid
 * entry is skipped. IdP role keys are stored lowercased for case-insensitive
 * matching.
 */
export function getRoleMap(): Record<string, AppRole> {
  const raw = process.env.SSO_ROLE_MAP || '';
  const map: Record<string, AppRole> = {};
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(':');
    if (sep === -1) continue;
    const iamRole = trimmed.slice(0, sep).trim();
    const appRole = trimmed.slice(sep + 1).trim();
    if (!iamRole || !isAppRole(appRole)) continue;
    map[iamRole.toLowerCase()] = appRole;
  }
  return map;
}

/**
 * Candidate role identifiers carried by a raw roles claim, before any mapping.
 *
 * Shared by mapRolesToAppRole and the caller's "claim matched nothing" warning
 * so both read the claim identically — a second copy of this shape handling
 * would be the thing that silently drifts.
 */
export function extractRoleCandidates(claimValue: unknown): string[] {
  if (Array.isArray(claimValue)) {
    return claimValue.map((v) => String(v));
  }
  if (typeof claimValue === 'string') {
    return claimValue.split(/[,\s]+/);
  }
  if (claimValue !== null && typeof claimValue === 'object') {
    // Role-code -> role-name map. Take keys plus any string values; non-string
    // values (nested objects/arrays) are skipped rather than stringified, so
    // nothing like "[object Object]" can ever become a lookup key.
    const entries = Object.entries(claimValue as Record<string, unknown>);
    return [
      ...entries.map(([key]) => key),
      ...entries.map(([, value]) => value).filter((v): v is string => typeof v === 'string'),
    ];
  }
  return [];
}

/** True when `candidate` resolves to an app role under the configured map. */
export function isMappedRole(candidate: string, map: Record<string, AppRole>): boolean {
  return map[candidate.trim().toLowerCase()] !== undefined;
}

/**
 * Map IdP role claim values to the single highest-privilege app role.
 *
 * @param claimValue One of:
 *   - an array of roles: `["ideahub_admin"]`
 *   - a delimited string (comma/space): `"ideahub_admin ideahub_user"`
 *   - an object keyed by role code: `{"IH002":"ideahub_admin"}` — the shape the
 *     DIAM corporate IAM actually sends for `diam:roles`. BOTH the keys and the
 *     string values are offered as candidates, so SSO_ROLE_MAP may be keyed on
 *     either the opaque codes (`IH002`) or the role names (`ideahub_admin`)
 *     without needing to know which the IdP will use. This cannot over-grant:
 *     only identifiers explicitly present in SSO_ROLE_MAP map to anything, and
 *     everything else is ignored.
 *   - undefined
 *
 *   Anything with no mapped match resolves to the least-privilege 'USER'.
 */
export function mapRolesToAppRole(claimValue: unknown): AppRole {
  const map = getRoleMap();
  const incoming = extractRoleCandidates(claimValue);

  let best: AppRole = 'USER';
  let bestPriority = -1;
  for (const role of incoming) {
    const key = role.trim().toLowerCase();
    if (!key) continue;
    const mapped = map[key];
    if (mapped && ROLE_PRIORITY[mapped] > bestPriority) {
      best = mapped;
      bestPriority = ROLE_PRIORITY[mapped];
    }
  }
  return best;
}

/**
 * Emails that must NEVER be able to authenticate via SSO — they are reserved
 * for local "break-glass" login. Parsed from BREAK_GLASS_EMAILS (csv,
 * lowercased). When BREAK_GLASS_EMAILS is unset/empty it defaults to
 * [ADMIN_EMAIL] if that is set (fail-closed: the bootstrap admin stays local).
 */
export function getBreakGlassEmails(): string[] {
  const raw = process.env.BREAK_GLASS_EMAILS;
  if (raw !== undefined && raw.trim() !== '') {
    return raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0);
  }
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail && adminEmail.trim()) {
    return [adminEmail.trim().toLowerCase()];
  }
  return [];
}
