# IdeaHub — Delivery Plan & Status

_Last updated: 2026-07-25. Living document — update as phases complete._

## 1. Shipped & independently verified

| Item | Contents | Status |
|---|---|---|
| Node 22 + multi-arch CI | CI matrix 22.x, Dockerfiles `node:22-alpine`, amd64+arm64 image builds | committed |
| **Feature 1 — SSO via corporate IAM (OIDC)** | Auth-code + PKCE flow, JIT provisioning, link-by-email, `SSO_ROLE_MAP` (highest wins, unmapped→USER), org claim → `User.department`, break-glass local login, SSO users have no logout / change-password UI (IAM owns the session; dormant RP-initiated logout capability kept, tested), admin cannot edit SSO-managed users | committed, verifier CONFIRMED; IAM email-ownership verification confirmed by sec team |
| i18n runtime fix | CSP-safe precompilation (`unplugin-vue-i18n` **pinned ^4** for vue-i18n 9 — do not bump independently); runtime smoke guard `frontend/scripts/i18n-smoke.ts`. NOTE: prod images built March→July 2026 render raw keys — redeploy fixes | committed |
| Frontend component tests | 8 suites / 78 tests (stores, pages, interceptor) | committed, verified |
| Backend integration tier | `npm run test:integration`, 42 tests vs real Mongo (sessions, indexes, lifecycle, SSO upserts). Caught the real session-invalidation bug (F14) | committed, verified |
| Playwright E2E | 10 tests: local login, idea lifecycle, RBAC, SSO round-trip vs mock IdP, i18n toggle. New `e2e.yml` workflow | committed, verified |
| Dev tooling | VS Code debug configs (gitignored), Keycloak testing kit `dev/`, `scripts/build-images.sh` (amd64 target default, validated), `dev/IAM-REQUEST.md` sec-team checklist | committed / pending commit |

## 2. Security hardening (task #3) — ✅ COMPLETE (2026-07-25, verifier CONFIRMED)

Implemented and mostly verified (5 waves): Mongo **auth enabled** (root creds + auto-generated keyFile, authed healthcheck; local volume already migrated; other machines need one-time `docker compose down -v && docker compose up -d`), deterministic root-context `npm ci` builds off the single root lockfile, pinned base images, non-root nginx (uid 101) + extended CSP (`base-uri`/`form-action`/`object-src`; **never** re-add `unsafe-eval`), prod-compose fail-fast guards, login timing equalization, password min 12 (new passwords only), **F14 fixed**: role/email change now truly destroys the target's sessions (`stringify:false` + `collectionP`), regression test active.

**Close-out record:** the first verification refuted one item — `bcrypt@5.1.1` (production dep) shipped a critical `tar` chain into the backend image. Remediated per user's option (b): lockfile restored to HEAD baseline (user-run git), targeted in-range bumps re-applied (`axios 1.18.1`, `body-parser 1.20.6`, `@babel/core 7.29.7`), **bcrypt ^6.0.0** (+`@types/bcrypt` ^6) eliminating the tar/node-pre-gyp chain, and the session-invalidation error-handling hardened in `users.ts`. Final state, independently re-verified: `npm audit --omit=dev` = **0 vulnerabilities**; full tree 0 critical / 26 high all devDependencies-only (jest/ts-jest/vue-tsc chains — clearing them requires major tool bumps, accepted residual); tar & node-pre-gyp absent from lockfile AND built image; bcrypt 6 proven functional on alpine/musl; lockfile diff surgical (+42/−372); all four tiers green (214 / 42 / 349 / 10).

## 3. Next — Feature 2: departments (redesigned 2026-07-25; ⛔ starts only on explicit user go)

Departments are an **admin-managed list**; an idea's department = the department the idea **targets** (submitter picks one; required; defaults to first-by-order). Auto-seeded default **"Všeobecné"**; all existing ideas backfilled to it (idempotent, at boot). Admin CRUD: create, rename (always allowed), **reorder** (first = default), delete blocked while referenced or when last remaining. `User.department` (author's org claim, from F1) stays as a separate, orthogonal attribute.

Implementation notes: `Department {name @unique, order}`; `Idea.departmentId` **optional in Prisma schema but required at API layer** (required-field-on-existing-Mongo-docs crashes reads — lesson from F1's `authProvider`). Department filter/chips on all idea lists + detail; reports by-department + CSV column (appended last — a test pins column order); dashboard chart; new admin Departments page; EN+SK labels (department *names* are data — never in locale files). Coverage in all four test tiers, incl. E2E "reorder changes the submit-form default".

## 4. Later

- **#8 Email sending infrastructure** (prerequisite for #7): env-configured SMTP (confirm company relay), `MAIL_ENABLED=false` default, async best-effort send API (never fails a request), dev story (log-only/mailpit), mock-transport tests.
- **#7 Department notification emails**: each department gets admin-managed notification addresses; idea creation sends a note to the target department. Thin consumer of #2 + #8.

## 5. Key decisions log

- SSO: OIDC auth-code via corporate IAM (AD → IAM → token); roles from token claims via env map; mock-first, config-only production onboarding (`dev/IAM-REQUEST.md`).
- SSO users: no logout & no change-password UI (corporate-intranet pattern); break-glass emails can never convert to SSO.
- IAM verifies email ownership — link-by-email account takeover concern signed off (2026-07-25).
- No production data worth preserving (2026-07-25) — migrations may assume fresh volumes.
- Single root `package-lock.json` is authoritative; Docker builds use root context + `npm ci`.
- `@intlify/unplugin-vue-i18n` pinned **^4** while vue-i18n is v9 (CSP-safe JIT); bump only together.
- Git operations (branch/commit/push/restore) are performed by the user; assistant edits files and runs checks only.
- Idea department = *target* department (not author's org) — redesign decision 2026-07-25.

## 6. Open items / follow-ups

- IAM team answers pending (issuer, client registration, claim names + sample org values, role provisioning, `client_secret_basic` support — fallbacks documented in `dev/IAM-REQUEST.md` §F).
- Least-privilege Mongo application user (app currently authenticates as root) — follow-up hardening.
- Integration tier ~2% flake under rapid re-runs (boot-timing suspect) — uncharacterized, watch in CI.
- HSTS: enable in nginx when TLS terminates there (prepared, commented).
- Prod redeploy needed to pick up: i18n fix (translations broken in deployed images since March), hardened images, Mongo auth (fresh volume).
- Playwright X-Forwarded-For fixture now redundant (limiter skips under NODE_ENV=test) — harmless, optional cleanup.
