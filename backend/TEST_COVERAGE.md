# IdeaHub Test Coverage

_Last regenerated: 2026-07-31_

Test coverage spans four tiers. This document lists every suite file with a short
description of what it actually covers; it is intentionally not a test-by-test
enumeration.

| Tier | Command | Totals |
|---|---|---|
| Backend unit / route (mocked Prisma — no database) | `npm test` (in `backend/`) | 474 tests across 14 Jest suites |
| Backend integration (real MongoDB) | `npm run test:integration` (in `backend/`) | 83 tests across 10 Jest suites |
| Frontend (Vitest) | `npm test` (in `frontend/`) | 445 tests across 16 files |
| End-to-end (Playwright) | `npm run test:e2e` (repo root) | 16 tests across 10 files (9 spec files + shared auth setup) |

Password policy note: admin-managed user passwords (create/update user) and the
self-service change-password flow enforce a **12-character minimum** (per
`src/utils/validation.ts`).

## Backend unit / route suites (`backend/src/__tests__/*.test.ts`)

Run against a mocked Prisma client and an in-process Express app — no database or
network. 474 tests across 14 suites.

- **auth.test.ts** — Authentication API: login, logout, `GET /me`, change-password,
  session management, per-endpoint rate limiting, and the SSO RP-initiated logout
  branch of `POST /logout`.
- **departments.test.ts** — Departments API: list, role guards on mutations, create,
  reorder, rename, per-department notification emails, and delete (including the
  last-department / in-use guards).
- **ideas.test.ts** — Ideas API end to end: list + filters, single fetch, create
  (with the department new-idea notification and creation rate limiting), update,
  the `/notify` opt-in toggle, approve / reject / claim / complete, delete, progress
  steps, and the fire-and-forget lifecycle submitter notifications (incl. STEP_ADDED
  and the self-notification / opt-out edge cases).
- **init-admin.test.ts** — `ensureAdminExists` bootstrap: creating the first admin
  from the `ADMIN_*` env on first run and skipping when one already exists.
- **integration.test.ts** — In-process end-to-end workflows over mocked Prisma (a
  unit-tier suite, distinct from the real-DB integration tier): full lifecycle
  (submit → approve → claim → complete), submit → reject, admin user management,
  authorization enforcement, and concurrent user sessions.
- **mail-settings.test.ts** — Mail settings API: authorization, `GET` (password never
  returned), `PUT` (validation + encryption at rest), and the `POST /test` send.
- **mail-templates.test.ts** — `newIdeaEmail` and `ideaLifecycleEmail` wording (en/sk,
  language fallback, admin subject override), single-pass interpolation injection
  safety, user-text line delimiting, the per-event lifecycle subjects/bodies, and
  that the Slovak output leaks no English wording.
- **mailer.test.ts** — `getEffectiveMailConfig`, `sendMail`, and `sendTestMail`:
  disabled log-only no-op, enabled send path, subject sanitization, swallowed send /
  settings-read failures, the caller-provided-config single-read optimization, the
  fixed test-send reason categories, and that no secret leaks into results.
- **options.test.ts** — Options API: `GET /api/options` runtime flags
  (`mailEnabled`, `ssoShowLogout`) for authenticated users.
- **reports.test.ts** — Reports API: summary, by-department, monthly-trend,
  top-contributors, and filtered (with CSV export), including regular-user role
  scoping.
- **secretbox.test.ts** — AES-256-GCM encrypt/decrypt roundtrip, fail-closed decrypt
  (returns null, never throws), encryption key handling, and `isMailKeyValid`.
- **sso.test.ts** — SSO/OIDC: enablement, login redirect, callback JIT provisioning,
  link-by-email, role and department mapping, failure redirects (no session),
  break-glass protection, SSO-account login / change-password / edit guards,
  RP-initiated logout, and userinfo claim sourcing.
- **users.test.ts** — Users API: list, single, create, update, and delete with RBAC
  and referential-integrity guards.
- **validation.test.ts** — All Zod schemas: login, create/update idea, department
  name / reorder / update (case-insensitive email dedupe), review note,
  change-password, create/update user (12-char password minimum), ideas query,
  filtered-report query, and pagination parameters.

## Backend integration suites (`backend/src/__integration__/*.itest.ts`)

Exercise the app against a **real MongoDB** (started separately;
`npm run test:integration`). 83 tests across 10 suites.

- **auth-session.itest.ts** — local auth against the real `connect-mongo` session
  store (cookie issuance, persistence, logout).
- **departments.itest.ts** — departments CRUD and notification-email persistence.
- **idea-lifecycle.itest.ts** — the idea lifecycle across roles with real
  persistence and event logging.
- **ideas-filters.itest.ts** — `GET /api/ideas` filters and pagination against real
  data.
- **mail-settings.itest.ts** — mail settings persistence and encrypted-password
  round-trip.
- **prune-sso-users.itest.ts** — `pruneOrphanSsoUsers` removes only orphaned SSO
  users (no session, no ideas, no events).
- **reports.itest.ts** — reports aggregations computed against real documents.
- **sso.itest.ts** — SSO JIT provisioning and re-sync against the real DB.
- **users-session-invalidation.itest.ts** — a role change via `PATCH /api/users/:id`
  invalidates existing sessions in the real store.
- **users-unique-index.itest.ts** — the `users.email` unique index is enforced by
  the database.

## Frontend suites (`frontend/src/__tests__/*.test.ts`)

Vitest component and store tests. 445 tests across 16 files.

- **auth.store.test.ts** — auth Pinia store (login, logout, current-user state).
- **client.interceptor.test.ts** — Axios client 401 response-interceptor handling.
- **DashboardPage.test.ts** — dashboard page stats and charts.
- **departments.store.test.ts** — departments store (`fetchAll`, getters).
- **DepartmentsPage.test.ts** — departments admin page.
- **i18n.test.ts** — translation catalogs, runtime switching, and component
  translation coverage.
- **IdeaCard.test.ts** — idea card component rendering.
- **IdeaDetailPage.test.ts** — idea detail page, including the notify opt-in toggle.
- **LoginPage.test.ts** — login page in SSO-disabled and SSO-enabled modes.
- **mailSettings.store.test.ts** — mail settings store (`fetch`, `save`).
- **MailSettingsPage.test.ts** — email settings admin page.
- **MainLayout.test.ts** — main layout, locale toggle, and logout.
- **MyIdeasPage.test.ts** — my-ideas page.
- **options.store.test.ts** — runtime-options store (`mailEnabled`, `ssoShowLogout`).
- **SubmitIdeaPage.test.ts** — submit-idea page, including the lifecycle-notification
  toggle.
- **UsersPage.test.ts** — users admin page.

## End-to-end suites (`e2e/*.spec.ts`)

Playwright drives the real backend, frontend, and a mock IdP (each spec starts from
shared storage state). 16 tests across 10 files.

- **support/auth.setup.ts** — shared setup that signs in as user / power user /
  admin and saves the storage state reused by the specs.
- **departments.spec.ts** — admin creates/renames a department, reordering changes
  the submit-form default, a notification email persists, and deleting a referenced
  department is blocked.
- **i18n.spec.ts** — switching to Slovak translates nav labels and persists across
  reload.
- **idea-lifecycle.spec.ts** — submit → approve → claim → complete, with chips
  reflecting each stage.
- **local-login.spec.ts** — the seeded admin signs in, sees their identity, and logs
  out.
- **mail-settings.spec.ts** — admin saves email settings and they persist on reload.
- **notifications.spec.ts** — the per-idea notify toggle: hidden when mail is off,
  submitter-only when mail is on, and persists.
- **rbac.spec.ts** — a regular USER sees no Review Queue / Users nav and is bounced
  from `/users`; an ADMIN sees both and can open Users.
- **sso-failed.spec.ts** — the error banner shows on `/login?error=sso_failed`.
- **sso-login.spec.ts** — the SSO OIDC round-trip with identity and role/department
  mapping, ending in the admin view.

## Maintenance

Regenerate the totals and this file when suites are added or removed:

- Backend: `npm test` and `npm run test:integration` in `backend/` print the suite
  and test counts.
- Frontend: `npm test` in `frontend/`.
- E2E: `npx playwright test --list` at the repo root.
