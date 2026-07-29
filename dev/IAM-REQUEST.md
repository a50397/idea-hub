# IAM / Security Team Request — IdeaHub SSO Rollout

Everything IdeaHub needs from the IAM & security team before production
rollout. Updated 2026-07-28 against the **IAM Integračná príručka v2.4.1**
(IAM CORE3 / WEB2 — "DIAM", OAuth2/OpenID Connect interface). Markers:

- **[confirm]** — an answer we need from the IAM/security team,
- **[our proposal]** — our suggested value; needs internal sign-off before
  this request is sent.

IdeaHub is an OIDC Relying Party: authorization-code flow + PKCE (S256,
which the guide mandates), confidential client, server-side sessions. Per the
guide, the DIAM ID token typically carries only `sub`; IdeaHub therefore reads
claims from the **ID token merged with the userinfo response** (`/oidc/userinfo`).
All IAM specifics below are configuration on our side (env vars — mapping
table at the end).

The guide lists three DIAM environments (**integračné / testovacie /
produkčné**) but the copy we received has the URLs redacted. **[confirm]**
Please provide the issuer URL for each environment. **Each environment needs
its own client registration** — we would like to start on the integration
environment.

---

## A. Client registration request

Register an **OIDC confidential client** per environment. Ready-to-send
parameter set — matches the DIAM registration endpoint schema (RFC 7591), and
doubles as a checklist if registration is done through the admin console:

```json
{
  "client_name": "IdeaHub",
  "redirect_uris": ["https://ideahub/api/auth/sso/callback"],
  "post_logout_redirect_uris": ["https://ideahub/login"],
  "token_endpoint_auth_method": "client_secret_basic",
  "grant_types": ["authorization_code"],
  "response_types": ["code"],
  "scope": "openid profile email diam diam:user",
  "diam_claim_types": ["diam:roles"],
  "diam_token_exp": 28800,
  "diam_authn": ["W", "L"],
  "diam_authn_default": "W",
  "contacts": ["Peter Stolc <work email TBD>"]
}
```

Hosts: production `https://ideahub` (TLS is being finalized on our side and is
a prerequisite — the redirect URI is exact-match). Integration/test hosts for
IdeaHub itself: TBD on our side; the JSON above is per-environment with only
the host changing.

Notes on the choices:

- **`scope`** — `openid profile email` for identity, plus whichever scope
  releases the roles claim. **[confirm]** which scope releases `diam:roles`
  in userinfo (`diam`? `diam:user`?) — we will trim the request to exactly
  what is needed.
- **`diam_claim_types`** — we need only `diam:roles`; no permissions, modules,
  or application identifiers.
- **`diam_authn`** — **[our proposal]**: AD domain login (`W`) as default with
  password fallback (`L`); no certificate (`C`) or ÚPVS (`E`) login. If the
  automatic domain login variant (the `LoginWAuto` equivalent) is available
  for OIDC clients, please enable it as the default.
- **`diam_token_exp`** — **[our proposal]** 28 800 s (8 h), matching the org
  convention in the guide.
- We do **not** need: `refresh_token` or `client_credentials` grants,
  signed/encrypted userinfo responses, pairwise subjects, request objects, or
  PAR. Plain defaults everywhere not listed.
- **Consent screen** — internal line-of-business app: **[confirm]** please
  disable mandatory consent for this client, or confirm one-time consent is
  acceptable.

**We need back:** issuer URL per environment, `client_id`, `client_secret`
(via a secure channel — vault/password manager, not email or chat), and the
role codes (section C).

Register the post-logout redirect URI even though in-app logout is currently
hidden for SSO users — RP-initiated logout is built and dormant, and the guide
confirms DIAM advertises `end_session_endpoint`; registering now avoids a
second ticket.

## B. Claims contract

Per the guide: ID token ≈ `sub` only; profile claims come from
`GET /oidc/userinfo` (standard `name`, `given_name`, `family_name`,
`preferred_username`, `email`, …) and roles come as `diam:*` claim types in
the userinfo response. IdeaHub merges userinfo claims into the ID-token claims
at login (ID token wins on conflict). What we still need:

1. **`sub` stability** — **ANSWERED 2026-07-29: confirmed** (stable, never
   reassigned to another person). IdeaHub keys user accounts on it.
2. **Roles claim shape** — **ANSWERED 2026-07-29**: the claim is `diam:roles`
   in the userinfo response, a plain **array of role-name strings** (sample:
   `"diam:roles": ["admin", "r01"]`). Works with our parser out of the box —
   no adapter needed; the values become `SSO_ROLE_MAP` keys. Still open: the
   exact scope string to request (confirm at credential handover or first
   integration test).
3. **Department / org unit** — the standard userinfo claims carry no
   department and the diam scopes do not obviously include one. IdeaHub uses
   it only to group ideas; it can be empty. Options, in our order of
   preference — **[confirm]** which is feasible:
   1. release an org-unit value via `diam:application_data`,
   2. define a custom scope/fact (the guide warns new scopes are laborious),
   3. we drop department sync for SSO users entirely.
4. **Email / display name** — standard `email` and `name` per the guide's
   userinfo table; defaults on our side already match. Flagging only in case
   this deployment differs.
5. Email ownership is verified by the IAM before being issued in a token —
   **confirmed 2026-07-25**. (Kept for the record: IdeaHub links pre-existing
   local accounts to SSO identities by email at first SSO login.)

## C. Role provisioning

- Create **two** IdeaHub roles in the IAM role catalog (naming per IAM
  convention): administrators and reviewers ("power users"). No third role is
  needed — anyone who authenticates with no mapped role automatically becomes
  a regular user (least-privilege default in `mapRolesToAppRole`). The role
  **codes** that arrive in `diam:roles` are mapped via our `SSO_ROLE_MAP`.
- **[confirm]** the final role codes/names, who owns membership, and the
  joiner/mover/leaver process.

## D. Policy questions for the security team

1. **Sessions**: IdeaHub sessions last 7 days and roles/departments refresh
   **only at login**; the DIAM session (`diam_token_exp`) would be 8 h.
   Someone removed from a role keeps their current app access until session
   expiry or next login. Acceptable, or is a shorter app-session TTL required?
2. **SSO users have no in-app logout** (deliberate — the IAM session owns
   sign-in, corporate-intranet pattern). Confirm this matches policy.
   RP-initiated logout is implemented, tested, and dormant; DIAM's
   `end_session_endpoint` makes it enableable at any time via the
   `SSO_SHOW_LOGOUT=true` config flag (no code change).
3. **Backchannel logout**: DIAM supports it; IdeaHub does not currently
   implement it, so an IAM-side logout does not terminate existing IdeaHub
   sessions (they age out per item 1). **[confirm]** whether policy requires
   backchannel logout — if yes, we will schedule that endpoint before rollout.
4. **Break-glass local admin account** exists (password login, non-directory
   email) as the IAM-outage escape hatch. It can never authenticate via SSO.
   Please advise on credential storage/rotation requirements.
5. Where should `client_secret` and the app `SESSION_SECRET` live in
   production (vault / secret manager)?
6. For the record: MongoDB now runs authenticated (root user, keyFile-secured
   replica set) — the earlier open hardening item from this document is
   resolved.

## E. Infrastructure

- **Discovery URL** — **ANSWERED 2026-07-29**: the standard well-known path is
  served — `https://idp.iam-intranet/.well-known/openid-configuration` (which
  also gives us the issuer: `SSO_ISSUER_URL=https://idp.iam-intranet`). No
  fallback needed on our side.
- **Egress**: the IdeaHub backend needs HTTPS access to the issuer —
  discovery, JWKS, token endpoint, **and userinfo endpoint**. Firewall/proxy
  rule if applicable.
- **Browser path**: users' browsers must reach the DIAM login page.
- Will IdeaHub also sit behind a corporate SSO gateway / WAF? (Double-proxying
  changes the effective redirect URI and forwarded headers — must be known
  before go-live.)
- Any rate limits on the token or userinfo endpoints we should respect?
  (Access tokens are short-lived reference tokens; we call userinfo once per
  login, immediately after the code exchange.)
- Clock: the guide requires time synchronization; IdeaHub tolerates 60 s of
  skew when validating tokens.
- Our prerequisite (internal): HTTPS on `ideahub` must be live before the
  production redirect URI can be registered.

## F. Token endpoint auth method

The guide's sample metadata lists `client_secret_basic` as supported — our
preferred method, so no action is expected. If this deployment differs, check
what it supports:

```bash
curl -s https://<issuer>/.well-known/openid-configuration \
  | jq .token_endpoint_auth_methods_supported
```

Switching methods (`client_secret_post`, `private_key_jwt`, …) is a small,
low-risk change on our side (`backend/src/routes/sso.ts`, client
construction); `private_key_jwt` additionally needs a keypair + JWKS
registration and an agreed rotation cadence. `none` (public client) only with
explicit security-team sign-off.

---

## Answer → configuration mapping

| Their answer | Our env var | Expected per the guide |
|---|---|---|
| Issuer URL (per environment) | `SSO_ISSUER_URL` | `https://<diam-host>` |
| Client ID / secret | `SSO_CLIENT_ID` / `SSO_CLIENT_SECRET` | from registration |
| Registered redirect URI | `SSO_REDIRECT_URI` | `https://ideahub/api/auth/sso/callback` |
| Registered post-logout URI | `SSO_POST_LOGOUT_REDIRECT_URI` | `https://ideahub/login` |
| Scopes to request | `SSO_SCOPE` | `openid profile email` + roles scope (§B.2) |
| Roles claim name / values | `SSO_ROLES_CLAIM` / `SSO_ROLE_MAP` | likely `diam:roles`; map role codes → `ADMIN`/`POWER_USER`/`USER` |
| Org claim name | `SSO_ORG_CLAIM` | pending §B.3 |
| Email / name claim names | `SSO_EMAIL_CLAIM` / `SSO_NAME_CLAIM` | defaults `email` / `name` match |
| — | `SSO_ENABLED=true`, `BREAK_GLASS_EMAILS` (defaults to `ADMIN_EMAIL`) | |
