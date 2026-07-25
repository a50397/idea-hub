# IAM / Security Team Request — IdeaHub SSO Rollout

Everything IdeaHub needs from the IAM & security team before production rollout.
Replace `https://ideahub.example.com` with the real host. **Each environment
(staging, production) needs its own client registration** — duplicate section A
per environment.

IdeaHub is an OIDC Relying Party: authorization-code flow + PKCE (S256),
confidential client, server-side sessions. All IAM specifics below are
**configuration only** on our side (env vars, see the mapping table at the end).

---

## A. Client registration request

Register an **OIDC confidential client**:

| Item | Value |
|---|---|
| Grant type / response type | `authorization_code` / `code` |
| PKCE | S256 (always sent) |
| Redirect URI (exact match) | `https://ideahub.example.com/api/auth/sso/callback` |
| Post-logout redirect URI | `https://ideahub.example.com/login` |
| Token endpoint auth method | `client_secret_basic` preferred — see section F if unsupported |
| Requested scopes | `openid profile email` (+ any custom scope needed to release roles/org — tell us) |

**We need back:** issuer URL (its `/.well-known/openid-configuration` must be
reachable from the IdeaHub backend), `client_id`, `client_secret` (via a secure
channel — vault/password manager, not email or chat).

Register the post-logout redirect URI even though in-app logout is currently
hidden for SSO users — RP-initiated logout support is built and may be enabled
later; registering now avoids a second ticket.

## B. ID-token claims contract

IdeaHub reads claims from the **ID token** (not the userinfo endpoint, not the
access token). Please confirm each of the following:

1. **`sub`** is stable for the lifetime of a person and **never reused** for
   another person. IdeaHub keys user accounts on it — a recycled `sub` would
   inherit someone else's account.
2. **Roles claim** — exact claim name (our default: `roles`), the exact role
   values IdeaHub will receive, format (array preferred; space/comma-separated
   string also handled), and confirmation it is present **in the ID token**.
   Which scope releases it?
3. **Org/department claim** — claim name (our default: `org`) plus **sample
   values** (human-readable names like `Sales` vs. org-unit codes like
   `OU-4711`). IdeaHub groups ideas by this value verbatim.
4. **Email** and **display name** claim names if nonstandard (defaults:
   `email`, `name`).
5. Email ownership is verified by the IAM before being issued in a token —
   **confirmed 2026-07-25**. (Kept for the record: IdeaHub links pre-existing
   local accounts to SSO identities by email at first SSO login.)

## C. Role provisioning

- Create the IdeaHub app roles / AD-group mappings, e.g. `ideahub-admin`,
  `ideahub-power` (naming per IAM convention — whatever strings arrive in the
  roles claim are mapped via our `SSO_ROLE_MAP` config). Users with neither
  role become regular users.
- Who owns membership? What is the joiner/mover/leaver process?

## D. Policy questions for the security team

1. **Sessions last 7 days** and roles/departments refresh **only at login**.
   Someone removed from an AD group retains current app access until session
   expiry or next login. Acceptable, or is a shorter session TTL required?
2. **SSO users have no in-app logout** (deliberate — the IAM session owns
   sign-in, corporate-intranet pattern). Confirm this matches policy. If
   visible logout is required: RP-initiated logout is implemented and tested —
   does the IAM expose a standard `end_session_endpoint`?
3. **Break-glass local admin account** exists (password login, non-directory
   email) as the IAM-outage escape hatch. It can never authenticate via SSO.
   Please advise on credential storage/rotation requirements.
4. Where should `client_secret` and the app `SESSION_SECRET` live in
   production (vault / secret manager)?
5. Known internal item already scheduled on our side: MongoDB currently runs
   without authentication on an isolated container network — hardening is
   planned before rollout.

## E. Infrastructure

- **Egress:** the IdeaHub backend needs HTTPS access to the issuer (discovery,
  JWKS, token endpoint). Firewall/proxy rule if applicable.
- **Browser path:** users' browsers must reach the IAM login page.
- Will IdeaHub also sit behind a corporate SSO gateway / WAF? (Double-proxying
  changes the effective redirect URI and forwarded headers — must be known
  before go-live.)
- Any rate limits on the token endpoint we should respect?
- Clock: IdeaHub tolerates 60s of skew when validating tokens.

## F. If `client_secret_basic` is NOT supported

Our OIDC library (`openid-client` v5) supports all standard token-endpoint
auth methods; switching is a small, low-risk change. Steps:

1. **Check what the IAM supports** (no ticket needed):
   ```bash
   curl -s https://<issuer>/.well-known/openid-configuration \
     | jq .token_endpoint_auth_methods_supported
   ```
2. Pick the strongest mutually supported method, in this order of preference:
   | Method | What changes on our side |
   |---|---|
   | `client_secret_post` | Set `token_endpoint_auth_method: 'client_secret_post'` where the client is built (`backend/src/routes/sso.ts`, `new issuer.Client({...})`). Same secret, different transport. ~1 line. |
   | `client_secret_jwt` | Same one-line method switch; the shared secret signs a JWT assertion instead of being sent. |
   | `private_key_jwt` | Strongest. Generate an RSA/EC keypair, register the public JWKS with the IAM, load the private key from secure config and pass `jwks` to the client constructor + set the method. Small code change plus key storage/rotation process — agree rotation cadence with the security team. |
   | `none` (public client) | Last resort only if the IAM mandates it: drop the secret, keep PKCE. Weakest — no client authentication; requires explicit security-team sign-off. |
3. Re-run the SSO test suite and the local Keycloak flow (`dev/SSO-TESTING.md`)
   after the switch — Keycloak can be configured to the same method for a
   faithful rehearsal.

If desired, the method can be exposed as an env var (`SSO_TOKEN_AUTH_METHOD`)
so environments can differ without code changes.

---

## Answer → configuration mapping

| Their answer | Our env var |
|---|---|
| Issuer URL | `SSO_ISSUER_URL` |
| Client ID / secret | `SSO_CLIENT_ID` / `SSO_CLIENT_SECRET` |
| Registered redirect URI | `SSO_REDIRECT_URI` |
| Registered post-logout URI | `SSO_POST_LOGOUT_REDIRECT_URI` |
| Scopes to request | `SSO_SCOPE` |
| Roles claim name / values | `SSO_ROLES_CLAIM` / `SSO_ROLE_MAP` (e.g. `ideahub-admin:ADMIN,ideahub-power:POWER_USER`) |
| Org claim name | `SSO_ORG_CLAIM` |
| Email / name claim names | `SSO_EMAIL_CLAIM` / `SSO_NAME_CLAIM` |
| — | `SSO_ENABLED=true`, `BREAK_GLASS_EMAILS` (defaults to `ADMIN_EMAIL`) |
