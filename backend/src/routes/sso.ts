import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import crypto from 'crypto';
import { Issuer, generators, custom, type Client } from 'openid-client';
import prisma from '../lib/prisma';
import {
  isSsoEnabled,
  getSsoConfig,
  mapRolesToAppRole,
  getRoleMap,
  extractRoleCandidates,
  isMappedRole,
  getBreakGlassEmails,
} from '../config/sso';

const router = Router();

// Rate limit the whole SSO router by IP. Mirrors loginLimiter (skips under
// NODE_ENV==='test'). We do NOT reuse passwordChangeLimiter because its
// keyGenerator reads req.session.userId, which is undefined pre-auth.
const ssoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many SSO requests. Please try again later.' },
});
router.use(ssoLimiter as any);

// ---------------------------------------------------------------------------
// HTTP timeout for every openid-client request: discovery, JWKS, token
// exchange and userinfo. The library default is 3500ms, which our slow IdP exceeds.
// ---------------------------------------------------------------------------
custom.setHttpOptionsDefaults({ timeout: 15000 });

// ---------------------------------------------------------------------------
// OIDC issuer discovery (cached in a module-level promise, cleared on failure
// so a transient discovery error does not permanently break SSO).
// ---------------------------------------------------------------------------
let discovery: Promise<Issuer> | null = null;

function discoverIssuer(issuerUrl: string): Promise<Issuer> {
  if (!discovery) {
    discovery = Issuer.discover(issuerUrl)
      .then((issuer) => {
        // Log the discovered endpoint set once per process (the promise is
        // cached, so this runs once). An IdP may serve userinfo or token from a
        // different host than the issuer, and a host-specific egress
        // restriction is otherwise invisible: openid-client races its own timer
        // against the socket and throws a bare RPError carrying no
        // code/hostname, so the failure cannot be attributed to a host without
        // knowing these URLs.
        const m = issuer.metadata;
        console.log(
          'SSO discovery OK:',
          [
            `issuer=${m.issuer}`,
            `authorization_endpoint=${m.authorization_endpoint ?? '(absent)'}`,
            `token_endpoint=${m.token_endpoint ?? '(absent)'}`,
            `userinfo_endpoint=${m.userinfo_endpoint ?? '(absent)'}`,
            `jwks_uri=${m.jwks_uri ?? '(absent)'}`,
            `end_session_endpoint=${m.end_session_endpoint ?? '(absent)'}`,
          ].join(' ')
        );

        // What the IdP says it can release, next to what we currently ask for.
        // When userinfo is unreachable the only way back to a complete claim set
        // is to get email/roles into the id_token instead, and these three
        // fields say whether that is achievable from our side (via the OIDC
        // `claims` request parameter and/or a wider scope) or needs an IdP-side
        // config change.
        const flat = (v: unknown): string =>
          Array.isArray(v) ? v.join(',') : v === undefined ? '(absent)' : String(v);
        console.log(
          'SSO claim capability:',
          [
            `configured_scope=${getSsoConfig().scope}`,
            `claims_parameter_supported=${flat(m.claims_parameter_supported)}`,
            `scopes_supported=${flat(m.scopes_supported)}`,
            `claims_supported=${flat(m.claims_supported)}`,
          ].join(' ')
        );
        return issuer;
      })
      .catch((err: unknown) => {
        discovery = null; // allow the next request to retry discovery
        throw err;
      });
  }
  return discovery;
}

async function buildClient(): Promise<Client> {
  const cfg = getSsoConfig();
  const issuer = await discoverIssuer(cfg.issuerUrl);
  const client = new issuer.Client({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uris: [cfg.redirectUri],
    response_types: ['code'],
  });
  client[custom.clock_tolerance] = 60; // tolerate small IdP/app clock skew (seconds)
  return client;
}

// ---------------------------------------------------------------------------
// RP-initiated logout (OIDC end-session).
//
// Builds the IdP end_session_endpoint URL the browser is sent to after the
// local session is destroyed, so the IdP session is also terminated. Reuses the
// shared, cached discovery/client above (no second discovery cache).
//
// Returns null when the discovered issuer advertises no end_session_endpoint
// (the IdP does not support RP-initiated logout); the caller then completes a
// local-only logout. Discovery failures propagate to the caller, which treats
// them as fail-safe (local logout already happened).
// ---------------------------------------------------------------------------
export async function buildEndSessionUrl(params: {
  idToken: string;
  postLogoutRedirectUri: string;
}): Promise<string | null> {
  const client = await buildClient();
  if (!client.issuer.metadata.end_session_endpoint) {
    return null;
  }
  return client.endSessionUrl({
    id_token_hint: params.idToken,
    post_logout_redirect_uri: params.postLogoutRedirectUri,
  });
}

// ---------------------------------------------------------------------------
// Signed OIDC transaction cookie.
//
// The session cookie is sameSite=strict in production, so it is NOT sent on the
// cross-site redirect back from the IdP. The OIDC transaction (state, nonce,
// PKCE verifier) therefore lives in its own sameSite=lax, HMAC-signed cookie
// scoped to the SSO path. The signature binds the transaction to this server
// so a client cannot forge or replay a transaction.
// ---------------------------------------------------------------------------
const TXN_COOKIE = 'sso_txn';
const TXN_COOKIE_PATH = '/api/auth/sso';
const TXN_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

// Dev fallback signing key — same pattern as the session secret in index.ts:
// prefer SESSION_SECRET, otherwise a random ephemeral key generated at boot so
// nothing is ever hardcoded. Read lazily so tests can set SESSION_SECRET first.
const txnFallbackKey = crypto.randomBytes(32);
function getTxnKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  return secret ? Buffer.from(secret, 'utf8') : txnFallbackKey;
}

interface TxnData {
  state: string;
  nonce: string;
  cv: string; // PKCE code_verifier
  iat: number; // issued-at (ms epoch)
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function signPayload(payloadB64: string): string {
  return crypto.createHmac('sha256', getTxnKey()).update(payloadB64).digest('base64url');
}

function createTxnCookie(data: TxnData): string {
  const payloadB64 = b64url(JSON.stringify(data));
  return `${payloadB64}.${signPayload(payloadB64)}`;
}

function verifyTxnCookie(raw: string | undefined): TxnData | null {
  if (!raw || typeof raw !== 'string') return null;
  const dot = raw.indexOf('.');
  if (dot === -1) return null;

  const payloadB64 = raw.slice(0, dot);
  const providedSig = raw.slice(dot + 1);
  const expectedSig = signPayload(payloadB64);

  const providedBuf = Buffer.from(providedSig);
  const expectedBuf = Buffer.from(expectedSig);
  // timingSafeEqual throws on length mismatch; a length mismatch is already a
  // non-match, so short-circuit.
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) return null;

  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (
    !data ||
    typeof data !== 'object' ||
    typeof (data as TxnData).state !== 'string' ||
    typeof (data as TxnData).nonce !== 'string' ||
    typeof (data as TxnData).cv !== 'string' ||
    typeof (data as TxnData).iat !== 'number'
  ) {
    return null;
  }

  const txn = data as TxnData;
  if (Date.now() - txn.iat > TXN_MAX_AGE_MS) return null; // expired
  return txn;
}

function txnCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax' as const,
    path: TXN_COOKIE_PATH,
    maxAge: TXN_MAX_AGE_MS,
  };
}

function clearTxnCookie(res: Response): void {
  res.clearCookie(TXN_COOKIE, { path: TXN_COOKIE_PATH });
}

// The app does not use cookie-parser, so read the transaction cookie directly
// from the Cookie header. Values are base64url + '.' + base64url, which are all
// URL-safe, so express's default encodeURIComponent serialization is a no-op.
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

function errorRedirect(): string {
  return `${process.env.FRONTEND_URL || ''}/login?error=sso_failed`;
}

// ---------------------------------------------------------------------------
// Render an unknown throwable with the fields that actually identify a failed
// back-channel call to the IdP.
//
// Node puts the decisive detail in `code`/`syscall`/`hostname`/`address`, NOT in
// `message`. Logging the message alone makes these indistinguishable, all of
// them surfacing as a generic 15s timeout:
//
//   EAI_AGAIN / ENOTFOUND  -> DNS: the host cannot resolve the IdP at all
//   ETIMEDOUT              -> packets leave and nothing returns (blackholed route)
//   ECONNREFUSED           -> host reachable, nothing listening on that port
//   UNABLE_TO_VERIFY_LEAF_SIGNATURE / SELF_SIGNED_CERT_IN_CHAIN -> CA trust
//
// openid-client wraps transport failures, so walk a bounded `cause` chain —
// the ErrnoException with the useful code is usually nested one level down.
// ---------------------------------------------------------------------------
type ErrnoLike = NodeJS.ErrnoException & {
  hostname?: string;
  address?: string;
  port?: number;
  cause?: unknown;
};

// ---------------------------------------------------------------------------
// Is the signature-verified id_token self-sufficient?
//
// Guards the userinfo-outage fallback below. Returns true only when the
// id_token alone carries BOTH privilege-relevant claims:
//
//   - email: the account identity, and the downstream '@' check gates login
//   - roles: absent/empty would make mapRolesToAppRole() default to 'USER',
//     silently downgrading an existing admin — the exact privilege-integrity
//     bug the fail-closed branch exists to prevent
//
// `name` is deliberately NOT required: it already falls back to the email and
// carries no privilege. Claims from an id_token are strictly stronger evidence
// than userinfo — openid-client verified its signature, issuer, audience,
// expiry and nonce during client.callback().
// ---------------------------------------------------------------------------
function idTokenIsSelfSufficient(
  claims: Record<string, unknown>,
  cfg: { emailClaim: string; rolesClaim: string }
): boolean {
  const email = claims[cfg.emailClaim];
  if (typeof email !== 'string' || !email.includes('@')) return false;

  const roles = claims[cfg.rolesClaim];
  if (Array.isArray(roles)) return roles.length > 0;
  if (typeof roles === 'string') return roles.trim() !== '';
  // Object form ({"IH002":"ideahub_admin"}), which is what DIAM sends. Kept in
  // step with mapRolesToAppRole: if the mapper can read a shape, the fallback
  // must accept it too, or a userinfo outage would fail closed on a claim set
  // that is in fact complete.
  if (roles !== null && typeof roles === 'object') return Object.keys(roles).length > 0;
  return false;
}

function describeError(err: unknown): string {
  const links: string[] = [];
  let current: unknown = err;

  for (let depth = 0; current instanceof Error && depth < 3; depth++) {
    const e = current as ErrnoLike;
    const detail = [
      depth === 0 ? e.message : `cause: ${e.message}`,
      e.code ? `code=${e.code}` : '',
      e.syscall ? `syscall=${e.syscall}` : '',
      e.hostname ? `hostname=${e.hostname}` : '',
      e.address ? `address=${e.address}${e.port ? `:${e.port}` : ''}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    links.push(detail);
    current = e.cause;
  }

  return links.length > 0 ? links.join(' | ') : String(err);
}

// ---------------------------------------------------------------------------
// GET /api/auth/sso/login — start the OIDC authorization-code + PKCE flow.
// ---------------------------------------------------------------------------
router.get('/login', async (req: Request, res: Response) => {
  if (!isSsoEnabled()) return res.status(404).json({ error: 'Not found' });

  try {
    const cfg = getSsoConfig();
    const client = await buildClient();

    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    res.cookie(
      TXN_COOKIE,
      createTxnCookie({ state, nonce, cv: codeVerifier, iat: Date.now() }),
      txnCookieOptions()
    );

    const authorizationUrl = client.authorizationUrl({
      scope: cfg.scope,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return res.redirect(authorizationUrl);
  } catch (err) {
    // Never surface IdP/discovery detail to the browser.
    console.error('SSO login initiation failed:', describeError(err));
    clearTxnCookie(res);
    return res.redirect(errorRedirect());
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/sso/callback — complete the flow and establish the session.
//
// On ANY failure we log the reason server-side, clear the transaction cookie,
// and redirect to the generic error page — no detail leaks to the browser.
// ---------------------------------------------------------------------------
router.get('/callback', async (req: Request, res: Response) => {
  if (!isSsoEnabled()) return res.status(404).json({ error: 'Not found' });

  const fail = (reason: string): void => {
    console.error('SSO callback failed:', reason);
    clearTxnCookie(res);
    res.redirect(errorRedirect());
  };

  try {
    // (1) IdP returned an error (e.g. access_denied).
    if (typeof req.query.error === 'string' && req.query.error) {
      return fail(`idp error: ${req.query.error}`);
    }

    // (2) Parse and verify the signed transaction cookie.
    const txn = verifyTxnCookie(readCookie(req, TXN_COOKIE));
    if (!txn) return fail('missing, tampered, or expired transaction cookie');

    // (3) Exchange the authorization code. openid-client verifies the returned
    // state, the id_token nonce, and the PKCE code_verifier.
    const cfg = getSsoConfig();
    const client = await buildClient();
    const tokenSet = await client.callback(cfg.redirectUri, client.callbackParams(req), {
      state: txn.state,
      nonce: txn.nonce,
      code_verifier: txn.cv,
    });

    // (4) Merge userinfo over the id_token claims, then extract and normalise.
    // Some IdPs mint a minimal id_token (only `sub`) and release email/name/
    // roles only from the userinfo endpoint, so without this the email check
    // below fails and every login dies. Passing the whole TokenSet makes
    // openid-client enforce that the userinfo `sub` matches the id_token `sub`.
    // id_token claims win: they are signature-verified, so userinfo only
    // supplements what the id_token omits. No userinfo_endpoint keeps legacy
    // id-token-only.
    //
    // A userinfo failure is tolerated ONLY when the id_token is self-sufficient
    // (see idTokenIsSelfSufficient). That keeps the original privilege-integrity
    // guarantee intact: we proceed on a COMPLETE, signature-verified claim set,
    // never a partial one that would re-sync an existing user's role down to
    // USER. When the id_token is minimal, this still fails closed exactly as
    // before. The condition is evaluated per login, so the flow self-heals the
    // moment the IdP's userinfo endpoint is reachable again.
    let userinfoClaims: Record<string, unknown> = {};
    let userinfoDegraded = false;
    if (client.issuer.metadata.userinfo_endpoint && tokenSet.access_token) {
      try {
        userinfoClaims = await client.userinfo(tokenSet);
      } catch (err) {
        // Name the endpoint. A timeout here while discovery, JWKS and the token
        // exchange all succeeded points at a host- or path-specific egress
        // restriction rather than a broken IdP, and this is the only point in
        // the flow where the target URL is known.
        const endpoint = client.issuer.metadata.userinfo_endpoint ?? '(unknown)';

        let idClaims: Record<string, unknown> | null = null;
        try {
          idClaims = tokenSet.claims() as Record<string, unknown>;
        } catch {
          idClaims = null; // no verifiable id_token to fall back to
        }

        if (idClaims && idTokenIsSelfSufficient(idClaims, cfg)) {
          // Degraded but safe. Warn (never silent) so the IdP-side outage stays
          // visible in the logs while logins keep working.
          userinfoDegraded = true;
          console.warn(
            `SSO userinfo unavailable (endpoint=${endpoint}): ${describeError(err)}` +
              ' — proceeding on signature-verified id_token claims only;' +
              ' existing users keep their stored role/department'
          );
        } else {
          // Claim NAMES only — never values, which carry PII.
          const present = idClaims
            ? Object.keys(idClaims).sort().join(',') || '(none)'
            : '(no id_token)';
          return fail(
            `userinfo request failed (endpoint=${endpoint}): ${describeError(err)}` +
              ` | id_token lacks required ${cfg.emailClaim}/${cfg.rolesClaim} claims,` +
              ` cannot proceed safely | id_token claims present: [${present}]`
          );
        }
      }
    }
    const claims = { ...userinfoClaims, ...tokenSet.claims() };
    const email = String(claims[cfg.emailClaim] ?? '')
      .toLowerCase()
      .trim();
    if (!email.includes('@')) return fail('email claim missing or invalid');

    const nameClaim = claims[cfg.nameClaim];
    const name = nameClaim ? String(nameClaim) : email;
    const role = mapRolesToAppRole(claims[cfg.rolesClaim]);
    const orgClaim = claims[cfg.orgClaim];
    const department =
      typeof orgClaim === 'string' && orgClaim.trim() ? orgClaim.trim() : null;

    // Role-sourcing diagnostic. Three different faults all land every user on
    // the 'USER' default and are indistinguishable from the outside: the roles
    // claim was never released, it arrived under a name other than
    // SSO_ROLES_CLAIM, or its values do not match any SSO_ROLE_MAP key. Printing
    // the claim names beside the raw roles value and the configured map keys
    // separates them in one line. Role identifiers are authorisation data, not
    // personal data, so the value is safe to log; no other claim VALUE is
    // (notably never the email).
    console.log(
      'SSO claims resolved:',
      [
        `source=${Object.keys(userinfoClaims).length > 0 ? 'userinfo+id_token' : 'id_token-only'}`,
        `claim_names=[${Object.keys(claims).sort().join(',')}]`,
        `roles_claim=${cfg.rolesClaim}`,
        `roles_value=${JSON.stringify(claims[cfg.rolesClaim] ?? null)}`,
        `role_map_keys=[${Object.keys(getRoleMap()).join(',')}]`,
        `resolved_role=${role}`,
        `org_claim=${cfg.orgClaim}`,
        // Presence only. The question this answers is "did the org claim arrive
        // at all" (it does not, on DIAM); the value itself is org data we have
        // no reason to persist in logs.
        `department=${department === null ? 'absent' : 'present'}`,
      ].join(' ')
    );

    // Guardrail against an unannounced claim-format change (the IAM has already
    // switched diam:roles from array to object once without notice). A claim in
    // an unreadable shape, or whose values match no SSO_ROLE_MAP key, is
    // indistinguishable in the resulting data from a user who genuinely holds no
    // roles — both produce 'USER'. Say so loudly rather than downgrading in
    // silence. Deliberately NOT fatal: locking everyone out would be worse than
    // least-privilege, and break-glass local login stays available.
    const rawRoles = claims[cfg.rolesClaim];
    if (rawRoles !== undefined && rawRoles !== null) {
      const roleMap = getRoleMap();
      const candidates = extractRoleCandidates(rawRoles);
      if (!candidates.some((candidate) => isMappedRole(candidate, roleMap))) {
        console.warn(
          'SSO roles claim matched NOTHING — this login falls back to USER.' +
            ` roles_claim=${cfg.rolesClaim}` +
            ` shape=${Array.isArray(rawRoles) ? 'array' : typeof rawRoles}` +
            ` roles_value=${JSON.stringify(rawRoles)}` +
            ` candidates=[${candidates.join(',')}]` +
            ` role_map_keys=[${Object.keys(roleMap).join(',')}]` +
            ' — check SSO_ROLE_MAP against the value above, or whether the IdP changed the claim format.'
        );
      }
    }

    // (5) Break-glass emails may never authenticate via SSO.
    if (getBreakGlassEmails().includes(email)) {
      return fail('break-glass email attempted SSO');
    }

    // (6) Resolve/provision the user (uniqueness enforced here since ssoSub has
    // no DB unique index).
    //
    // On the degraded (userinfo-unavailable) path the id_token's roles claim is
    // non-empty but NOT provably complete — an IdP may release a subset there
    // and the rest only via userinfo. Writing `role` from a subset would demote
    // an existing admin, which is precisely what the fallback exists to
    // prevent; `department` would likewise be nulled when `org` lives only in
    // userinfo. So for a user who ALREADY EXISTS we leave both fields alone and
    // let the next healthy login re-sync them. A brand-new user has no prior
    // value to protect, so JIT provisioning uses whatever the id_token carried
    // (least privilege when it carried no roles).
    const idpOwnedFields = userinfoDegraded ? {} : { role, department };
    const sub = claims.sub;
    let resolvedUser = await prisma.user.findFirst({ where: { ssoSub: sub } });
    if (!resolvedUser) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        // Link an existing (local) account to SSO; drop its password.
        resolvedUser = await prisma.user.update({
          where: { id: existing.id },
          data: {
            ssoSub: sub,
            authProvider: 'SSO',
            passwordHash: null,
            name,
            ...idpOwnedFields,
          },
        });
      } else {
        // Just-in-time provisioning.
        resolvedUser = await prisma.user.create({
          data: {
            name,
            email,
            ssoSub: sub,
            authProvider: 'SSO',
            role,
            department,
          },
        });
      }
    } else {
      // Known SSO user: refresh profile from the IdP (source of truth).
      try {
        resolvedUser = await prisma.user.update({
          where: { id: resolvedUser.id },
          data: { name, email, ...idpOwnedFields },
        });
      } catch {
        // e.g. email now collides with another account's unique index.
        return fail('sso user update conflict');
      }
    }

    const sessionUser = resolvedUser;

    // (7) Fresh session to prevent fixation, then persist the auth fields.
    req.session.regenerate((regenErr) => {
      if (regenErr) return fail('session regenerate failed');
      req.session.userId = sessionUser.id;
      req.session.email = sessionUser.email;
      req.session.name = sessionUser.name;
      req.session.role = sessionUser.role;
      // Retain the ID token for RP-initiated logout (id_token_hint). Never
      // logged; never returned to the browser except inside the end-session URL.
      req.session.idToken = tokenSet.id_token;
      req.session.save((saveErr) => {
        if (saveErr) return fail('session save failed');
        clearTxnCookie(res);
        res.redirect(process.env.FRONTEND_URL || '/');
      });
    });
  } catch (err) {
    return fail(describeError(err));
  }
});

export default router;
