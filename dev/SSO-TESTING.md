# Testing SSO locally with Keycloak

The automated jest suite already covers the OIDC flow against an in-process mock IdP.
This setup is for **manual, clicking-through-the-UI testing** with a realistic IdP
(login form, users, roles→claims — behaves like the corporate IAM).

## 1. Start Keycloak (preconfigured, no console clicking needed)

```bash
docker compose -f dev/docker-compose.keycloak.yml up -d
# first boot takes ~30s; admin console: http://localhost:8080 (admin / admin)
```

The `ideahub` realm is imported automatically:

| Login | Password | Client roles        | org claim   | → IdeaHub result        |
|-------|----------|---------------------|-------------|-------------------------|
| alice | password | —                   | Engineering | USER, dept Engineering  |
| bob   | password | ideahub-power       | Sales       | POWER_USER, dept Sales  |
| carol | password | ideahub-admin       | IT          | ADMIN, dept IT          |

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
```

(Claim names need no config — the defaults `roles`, `org`, `email`, `name` match
what the realm's protocol mappers emit.)

## 3. Run and click

- F5 → "Full stack (BE + FE)" (or run backend + frontend yourself)
- Open http://localhost:5173/login → "Sign in with SSO" → Keycloak login form
- Log in as carol/password → you land in IdeaHub as ADMIN, department IT
- Users admin page shows the JIT-provisioned users with an SSO chip and locked editing

## What to verify

- Role mapping: alice=USER, bob=POWER_USER, carol=ADMIN (change a user's client role
  in Keycloak, log out/in again → role updates on next login)
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
