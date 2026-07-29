# Testing SSO locally with Keycloak

The automated jest suite already covers the OIDC flow against an in-process mock IdP.
This setup is for **manual, clicking-through-the-UI testing** with a realistic IdP
(login form, users, roles→claims). The realm is configured to mimic the corporate
IAM ("DIAM", per the IAM integration guide v2.4.1): a **minimal ID token**
(essentially only `sub`) with email/name/roles/org released **only via the
userinfo endpoint** — clicking through here rehearses the exact claims path
production will use. Also mirrored from DIAM: PKCE S256 is enforced by the
client, access tokens last 300 s, the SSO session 8 h, and the post-logout
redirect URI is exact-match (`http://localhost:5173/login`).

## 1. Start Keycloak (preconfigured, no console clicking needed)

```bash
docker compose -f dev/docker-compose.keycloak.yml up -d
# first boot takes ~30s; admin console: http://localhost:8080 (admin / admin)
```

The `ideahub` realm is imported automatically:

| Login | Password | Client roles        | org claim   | → IdeaHub result        |
|-------|----------|---------------------|-------------|-------------------------|
| user  | password | —                   | Engineering | USER, dept Engineering  |
| power | password | ideahub-power       | Sales       | POWER_USER, dept Sales  |
| admin | password | ideahub-admin       | IT          | ADMIN, dept IT          |

## 2. Point the backend at it

Add to your shell env or `.env` (the VS Code "Backend (tsx)" launch config inherits
`.env` via dotenv; its own `env` block only overrides DATABASE_URL/NODE_ENV/etc.):

```bash
SSO_ENABLED=true
SSO_ISSUER_URL=http://localhost:8080/realms/ideahub
SSO_CLIENT_ID=ideahub-local
SSO_CLIENT_SECRET=ideahub-local-dev-secret
SSO_REDIRECT_URI=http://localhost:3001/api/auth/sso/callback
SSO_ROLE_MAP=ideahub-admin:ADMIN,ideahub-power:POWER_USER
SSO_SCOPE=openid
SSO_ROLES_CLAIM=diam:roles
```

> **`SSO_SCOPE=openid` is required with this realm.** Keycloak 26 rejects
> requested scopes that are not assigned to the client (`error=invalid_scope`),
> and the DIAM-shaped client is pinned to the `basic` scope only. Claims are
> unaffected — the dedicated mappers populate userinfo regardless of scope.
> Production uses the scope list registered with the real IAM
> (dev/IAM-REQUEST.md §A); this override is dev-kit-only.

(The roles claim uses the real IAM's **confirmed** name `diam:roles` — set via
`SSO_ROLES_CLAIM` above — and, like the IAM (sample received 2026-07-29), the
value is a plain string array of role names. `org`, `email`, `name` keep their
default claim names; the ID token carries only `sub` and the backend merges
userinfo claims automatically.)

> **MongoDB now requires authentication.** The `mongo: up` task and the VS Code
> "Backend (tsx)" launch config already use the dev credentials
> (`MONGO_ROOT_USER` / `MONGO_ROOT_PASSWORD`, default `root` /
> `example-dev-password`, plus a credentialed `DATABASE_URL` with
> `authSource=admin`). This is unrelated to SSO and applies in both modes. If you
> have a Mongo data volume from **before** this change, recreate it **once** (this
> erases local Mongo data, which is expected):
> ```bash
> docker compose down -v && docker compose up -d --wait mongodb
> ```

## 3. Run and click

- F5 → "Full stack (BE + FE)" (or run backend + frontend yourself)
- Open http://localhost:5173/login → "Sign in with SSO" → Keycloak login form
- Log in as admin/password → you land in IdeaHub as ADMIN, department IT
- Users admin page shows the JIT-provisioned users with an SSO chip and locked editing

## What to verify

- Role mapping: user=USER, power=POWER_USER, admin=ADMIN (change a user's client
  role in Keycloak, log out/in again → role updates on next login)
- **RP-initiated logout round-trips via Keycloak and truly ends the IdP session**:
  set `SSO_SHOW_LOGOUT=true` in the backend env and restart it (the logout
  button is hidden for SSO users by default), then after logging in via SSO,
  click Logout. The browser is sent to Keycloak's
  `end_session_endpoint` and returned to `/login`. Now click "Sign in with SSO"
  again → Keycloak **prompts for credentials again** (it does not silently
  re-authenticate). Before this change the IdP session survived logout and SSO
  re-authenticated with no prompt.
  - Requires the client's `post.logout.redirect.uris` attribute (added to the
    realm). An **already-running** Keycloak must re-import the realm to pick it up:
    ```bash
    docker compose -f dev/docker-compose.keycloak.yml down -v && docker compose -f dev/docker-compose.keycloak.yml up -d
    ```
  - Local (non-SSO) logout is unaffected: it stays on `/login` with no IdP round-trip.
- `sso_failed` path: cancel on the Keycloak form (or stop Keycloak mid-flow) → back
  on /login with the error banner
- Local break-glass: the seeded admin still logs in via "Use a local account"
- Password login for an SSO user is refused (generic invalid-credentials message)

## Cleanup / notes

```bash
docker compose -f dev/docker-compose.keycloak.yml down   # stop (add -v to wipe realm state)
```

- Keycloak binds to 127.0.0.1 only.
- Redirect URIs `http://localhost:3001|3199|3299/*` are whitelisted in the realm
  (3001 = debug backend; the others are used by automated verification runs).
- Dev-only credentials throughout; never reuse any of this outside localhost.
