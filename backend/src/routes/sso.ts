import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import crypto from 'crypto';
import { Issuer, generators, custom, type Client } from 'openid-client';
import prisma from '../lib/prisma';
import {
  isSsoEnabled,
  getSsoConfig,
  mapRolesToAppRole,
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
// OIDC issuer discovery (cached in a module-level promise, cleared on failure
// so a transient discovery error does not permanently break SSO).
// ---------------------------------------------------------------------------
let discovery: Promise<Issuer> | null = null;

function discoverIssuer(issuerUrl: string): Promise<Issuer> {
  if (!discovery) {
    discovery = Issuer.discover(issuerUrl).catch((err: unknown) => {
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
    console.error('SSO login initiation failed:', (err as Error)?.message ?? err);
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
    // supplements what the id_token omits. A userinfo error is fail-closed — a
    // partial claim set would re-sync an existing user's role down to USER (a
    // privilege-integrity bug). No userinfo_endpoint keeps legacy id-token-only.
    let userinfoClaims: Record<string, unknown> = {};
    if (client.issuer.metadata.userinfo_endpoint && tokenSet.access_token) {
      try {
        userinfoClaims = await client.userinfo(tokenSet);
      } catch (err) {
        return fail(`userinfo request failed: ${(err as Error)?.message ?? 'unknown error'}`);
      }
    }
    const claims = { ...userinfoClaims, ...tokenSet.claims() };
    const email = String(claims[cfg.emailClaim] ?? '')
      .toLowerCase()
      .trim();
    if (!email.includes('@')) return fail('email claim missing or invalid');

    const nameClaim = claims[cfg.nameClaim];
    const name = nameClaim ? String(nameClaim) : email;
    const role = mapRolesToAppRole(claims[cfg.rolesClaim] as string[] | string | undefined);
    const orgClaim = claims[cfg.orgClaim];
    const department =
      typeof orgClaim === 'string' && orgClaim.trim() ? orgClaim.trim() : null;

    // (5) Break-glass emails may never authenticate via SSO.
    if (getBreakGlassEmails().includes(email)) {
      return fail('break-glass email attempted SSO');
    }

    // (6) Resolve/provision the user (uniqueness enforced here since ssoSub has
    // no DB unique index).
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
            role,
            department,
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
          data: { name, email, role, department },
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
    return fail((err as Error)?.message ?? 'unknown error');
  }
});

export default router;
