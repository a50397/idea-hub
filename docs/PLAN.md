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
| Dev tooling | VS Code debug configs (gitignored), Keycloak testing kit `dev/`, `scripts/build-images.sh` (amd64 target default, validated), `dev/IAM-REQUEST.md` sec-team checklist | committed |

## 2. Security hardening (task #3) — ✅ COMPLETE (2026-07-25, verifier CONFIRMED)

Implemented and mostly verified (5 waves): Mongo **auth enabled** (root creds + auto-generated keyFile, authed healthcheck; local volume already migrated; other machines need one-time `docker compose down -v && docker compose up -d`), deterministic root-context `npm ci` builds off the single root lockfile, pinned base images, non-root nginx (uid 101) + extended CSP (`base-uri`/`form-action`/`object-src`; **never** re-add `unsafe-eval`), prod-compose fail-fast guards, login timing equalization, password min 12 (new passwords only), **F14 fixed**: role/email change now truly destroys the target's sessions (`stringify:false` + `collectionP`), regression test active.

**Addendum 2026-07-25 (evening, verifier CONFIRMED):** general `/api` limiter reworked after it locked the user out of dev (429s without CORS headers masqueraded as CORS failures → SPA showed logout/no-SSO): `cors()` now precedes the limiter (throttled responses and preflights carry ACAO; preflights no longer consume budget — they previously double-billed every request), cap 100→300/15min, skip extended to `NODE_ENV=development`. Per-route login (10) / password-change (5) / SSO (30) limiters unchanged. Single-file fix (`backend/src/index.ts`), uncommitted.

**Close-out record:** the first verification refuted one item — `bcrypt@5.1.1` (production dep) shipped a critical `tar` chain into the backend image. Remediated per user's option (b): lockfile restored to HEAD baseline (user-run git), targeted in-range bumps re-applied (`axios 1.18.1`, `body-parser 1.20.6`, `@babel/core 7.29.7`), **bcrypt ^6.0.0** (+`@types/bcrypt` ^6) eliminating the tar/node-pre-gyp chain, and the session-invalidation error-handling hardened in `users.ts`. Final state, independently re-verified: `npm audit --omit=dev` = **0 vulnerabilities**; full tree 0 critical / 26 high all devDependencies-only (jest/ts-jest/vue-tsc chains — clearing them requires major tool bumps, accepted residual); tar & node-pre-gyp absent from lockfile AND built image; bcrypt 6 proven functional on alpine/musl; lockfile diff surgical (+42/−372); all four tiers green (214 / 42 / 349 / 10).

## 3. Feature 2 — departments — ✅ COMPLETE (2026-07-25, verifier CONFIRMED; awaiting user commit)

Implemented per the 2026-07-25 redesign (idea **targets** a department; submitter picks; required; defaults to first-by-order; `User.department` stays orthogonal):

- **Backend:** `Department {name @unique, order}`; `Idea.departmentId` **optional in schema / required at API** (as planned). Boot-time idempotent `ensureDepartments()` seeds default **"Všeobecné"** and backfills legacy ideas via **raw Mongo command** — Prisma `updateMany` cannot match a *missing* ObjectId field (only explicit null); empirically verified, integration-tested with a genuine missing-field doc. Admin CRUD `/api/departments`: rename always allowed; reorder = exact-permutation body → order=index (route registered before `/:id`); delete 409 while referenced or when last remaining. `?departmentId` filter on ideas list + filtered reports; `GET /api/reports/by-department` (zero-filled, role-scoped like /summary); CSV `Department` column appended **last** (header now 14 columns; pinned assertions updated).
- **Frontend:** departments Pinia store (2nd store; `defaultDepartment` = first-by-order); required submit-form select preselecting the default; department filter + chips on all six list surfaces (incl. ReviewQueue, Reports) + detail sidebar; dashboard "Ideas by Department" bar chart; admin Departments page (dialog CRUD mirroring UsersPage, up/down reorder buttons); 25 i18n keys in EN+SK (genuinely different Slovak, no department names in locales, **no new parity allowlist entries**).
- **E2E:** 3 new specs incl. the spec-pinned "reorder changes the submit-form default"; `departments.spec.ts` runs serial-within-file (reorder's exact-permutation API races concurrent creates under fullyParallel); idea-lifecycle selects its department explicitly.
- **Verification:** all four tiers green and independently re-verified end-to-end (fresh-context verifier CONFIRMED, incl. live authz probes and the missing-field backfill proof): **backend 266 / integration 54 / frontend 376 / E2E 13** (baselines were 214 / 42 / 349 / 10). No flakes across 4+ full runs. No new dependencies; lockfile untouched; Docker builds not run (no Dockerfile/dependency changes — can run on request).

## 4. #8 Email infrastructure — ✅ COMPLETE (2026-07-25, verifier CONFIRMED); #7 in progress

**#8 shipped** (commit "Add mail infrastructure"): `config/mail.ts` (lazy env getters, mirrors sso config) + `utils/mailer.ts` `sendMail({to,subject,text,html?}) → Promise<boolean>` — best-effort, NEVER throws (dead-relay probe resolved `false` in 4 ms; 10 s timeouts; fresh transport per send; auth only when `SMTP_USER` set; secrets proven absent from logs). `MAIL_ENABLED=false` default (exact `'true'` opt-in); effective-enabled also requires `SMTP_HOST`. Boot guard mirrors SESSION_SECRET: prod exits 1 on enabled-without-host, dev warns + degrades to log-only. Dev story: log-only default; mailpit via `docker compose --profile mail up -d mailpit` (pinned `axllent/mailpit:v1.30.5`, **loopback-bound** 1025/8025 — mongo/Keycloak precedent), `dev/MAIL-TESTING.md`. Deps: nodemailer 9.0.3 (zero transitive) + `@types/nodemailer` (dev), root-lockfile install; `npm audit --omit=dev` still 0; backend image build green. 20 mock-transport tests (backend unit now 286). #7 wiring idiom: `void sendMail(...)` fire-and-forget, never gate a response on it; the `[NOTIFICATION]` approve stub at `ideas.ts:311` remains untouched.

**#7 Department notification emails — ✅ COMPLETE (2026-07-25, verifier CONFIRMED; awaiting user commit)**: `Department.notificationEmails String[]` (missing-field reads proven safe for lists — `[]`, no backfill needed, pinned by raw-insert integration test); admin PATCH accepts name and/or emails (zod: max 20, trim+email, dedupe, empty clears); addresses visible ONLY to ADMIN via fail-closed `serializeDepartment` (leak-checked across all department-returning paths); idea CREATION fire-and-forgets `sendMail` to the target department's list after the 201 (subject `[IdeaHub] New idea for {dept}: {title}`; 201 proven invariant across mail disabled/success/failure/reject; empty list → no send; approve/reject untouched). Frontend: DepartmentsPage edit dialog (chips email input + validation), notifications count column, api/store `rename`→`update`, +4 i18n keys EN+SK. SMTP header injection probed empirically SAFE (nodemailer CRLF folding; no header breakout, no injected recipients). Tiers: backend 301 / integration 59 / frontend 379 green + typechecks + i18n-smoke; E2E extended to 14 expected — not yet run locally (dev servers hold the ports), covered by CI on push.

## 5. Key decisions log

- SSO: OIDC auth-code via corporate IAM (AD → IAM → token); roles from token claims via env map; mock-first, config-only production onboarding (`dev/IAM-REQUEST.md`).
- SSO users: no logout & no change-password UI (corporate-intranet pattern); break-glass emails can never convert to SSO.
- IAM verifies email ownership — link-by-email account takeover concern signed off (2026-07-25).
- No production data worth preserving (2026-07-25) — migrations may assume fresh volumes.
- Single root `package-lock.json` is authoritative; Docker builds use root context + `npm ci`.
- `@intlify/unplugin-vue-i18n` pinned **^4** while vue-i18n is v9 (CSP-safe JIT); bump only together.
- Git operations (branch/commit/push/restore) are performed by the user; assistant edits files and runs checks only.
- Idea department = *target* department (not author's org) — redesign decision 2026-07-25.
- Dev/E2E seed carries a 2nd department ("Marketing", order 1) for filter/report/chip variety — user-approved 2026-07-25. Production boot seeds only "Všeobecné"; no test may depend on Marketing existing.
- General `/api` rate limit: CORS-before-limiter, 300/15min in prod/staging, skipped in dev+test (user-approved 2026-07-25 after dev lockout). Per-route auth limiters keep their own tighter policies.
- nodemailer 9 approved as the backend SMTP dep (2026-07-25); mailpit dev service loopback-only behind compose profile `mail`.

## 6. Open items / follow-ups

- IAM team answers pending (issuer, client registration, claim names + sample org values, role provisioning, `client_secret_basic` support — fallbacks documented in `dev/IAM-REQUEST.md` §F).
- Company SMTP relay parameters (host/port/auth) TBD with infra team — production mail stays effectively log-only until configured (`dev/MAIL-TESTING.md`).
- Least-privilege Mongo application user (app currently authenticates as root) — follow-up hardening.
- Test-tier flake watch: integration ~2% under rapid re-runs (boot-timing suspect, none observed across 4+ full runs 2026-07-25); one unit-tier flake observed 2026-07-25 — mock-IdP "socket hang up" in SSO discovery (auth.ts:119 path), clean on retry; E2E: first local run after a dev vite session can hit 3-4 first-attempt timeouts from cold-start/Vite re-optimization (observed 2026-07-25: cold 1.2m + 4 retried vs warm 8.6s clean 13/13) — retry noise, not regression. All uncharacterized; watch in CI.
- Frontend: treat 429/network-failure on `/auth/me` as "backend unavailable" (keep auth state, surface an error) instead of silently routing to login — deliberately deferred from the 2026-07-25 limiter fix.
- Defense-in-depth (both safe today, verifier-noted 2026-07-25): route the departments `PATCH /reorder` response through `serializeDepartment` (currently admin-guard-only protects the emails field); optionally strip CR/LF from user text at the mailer boundary (nodemailer folding empirically neutralizes header injection already).
- E2E suite (14 expected after #7) pending one local run when ports 3001/5173 are free; CI runs it on push.
- RTK bash proxy intercepts `npx playwright test` (rewrites to JSON reporter, truncates output) — for trustworthy full output run `rtk proxy npx playwright test --reporter=line`.
- HSTS: enable in nginx when TLS terminates there (prepared, commented).
- Prod redeploy needed to pick up: i18n fix (translations broken in deployed images since March), hardened images, Mongo auth (fresh volume).
- Playwright X-Forwarded-For fixture: earlier noted as redundant, but 2026-07-25 recon found it is **active infrastructure** — the E2E backend does not run under NODE_ENV=test, so the per-context random IP genuinely isolates rate-limit buckets. Keep it.
