# Continuation prompt for a fresh session

Paste the block below into a new Claude Code session in this repo to continue the delivery.

---

Continue the IdeaHub delivery. Read `docs/PLAN.md` FIRST — it is the source of truth for shipped state, decisions, specs, and open items. Check `git status` and report the working-tree/commit state before changing anything. Project memory has gotchas (i18n version lock, SSO decisions, ask-before-remedy) — respect them.

Where we are: Feature 1 (SSO via corporate IAM), all three test tiers (frontend components, backend real-DB integration, Playwright E2E), and the security hardening pass (Mongo auth, deterministic non-root builds, dep remediation incl. bcrypt 6, session-invalidation bug fix) are COMPLETE and independently verified. See PLAN.md §1–2.

**This prompt is my explicit go-ahead for Feature 2 (departments)** as specified in PLAN.md §3 — the stop-gate on it is satisfied. Recreate the task board from PLAN.md: Feature 2 first, then #8 (email sending infrastructure) and #7 (department notification emails, blocked by both). After Feature 2 is implemented AND verified, STOP and wait for my go before starting #8.

Working agreements (unchanged from prior sessions):
1. I run ALL git operations (commit/branch/push/restore) personally. You edit files and run checks only, and you tell me when a commit point is ready and exactly which files belong in it.
2. Don't assume remedies from my problem reports — ask which fix I want before implementing (AskUserQuestion with options).
3. Delegate implementation to executor agents (security-sensitive work to the security executor); verify every non-trivial completed change with a fresh-context verifier before reporting it done.
4. Full gates for any change (current baselines; they grow as tests are added):
   - backend: `npx tsc --noEmit`, `npm test` (214), `npm run test:integration` (42 — needs `docker compose up -d --wait mongodb`; Mongo is AUTHED, creds in `.env`)
   - frontend: `npx tsc --noEmit`, `npx vue-tsc --noEmit`, `npm test` (349), `npx vite-node scripts/i18n-smoke.ts`
   - root: `npx playwright test` (10; ports 3001/5173 must be free — never kill my processes, report conflicts)
   - images when Docker-relevant: `docker build -f backend/Dockerfile .` and `-f frontend/Dockerfile .` (root context); `scripts/build-images.sh` targets linux/amd64
5. Hard technical constraints: never bump `@intlify/unplugin-vue-i18n` past ^4 while vue-i18n is v9; never add `unsafe-eval` to the CSP; new i18n keys go to BOTH `en.ts` and `sk.ts` with genuinely different Slovak (the parity test rejects identical values unless allowlisted); department NAMES are admin data (e.g. "Všeobecné") and never live in locale files; `Idea.departmentId` stays optional in the Prisma schema but required at the API layer (required-field-on-existing-Mongo-docs crashes reads); single root `package-lock.json` is authoritative.
6. Manual SSO testing uses the local Keycloak kit (`dev/SSO-TESTING.md`; users alice/bob/carol, password `password`). Production IAM onboarding answers are tracked in `dev/IAM-REQUEST.md`.
7. Keep `docs/PLAN.md` updated as phases complete.
