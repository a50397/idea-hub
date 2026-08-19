// Admin-only management of the singleton Jira integration configuration. The
// structural mirror of routes/webex-settings.ts (itself the mirror of
// routes/mail-settings.ts) for the third, EXECUTION channel.
//
//   GET  /api/jira-settings           -> masked settings + hasToken (no ciphertext)
//   PUT  /api/jira-settings           -> save (upsert) the single document; triggers
//                                        background cloud-id resolution (scoped tokens)
//   POST /api/jira-settings/test      -> refresh the stored cloud id, then probe the
//                                        SAVED config (GET /rest/api/3/myself)
//   GET  /api/jira-settings/projects  -> list projects the tech user can see
//
// Every route requires an ADMIN session (requireRole). The effective jira-enabled
// boolean any authenticated user needs (to drive UI) lives on GET /api/options
// (routes/options.ts), not here. The stored API token is AES-256-GCM ciphertext
// (utils/secretbox.ts, same MAIL_SETTINGS_KEY as the SMTP password and the Webex
// bot token) and is NEVER returned by any endpoint — the GET/PUT responses expose
// only a `hasToken` boolean. State-changing requests (PUT, POST) are additionally
// covered by the app-wide CSRF header check registered in index.ts.
//
// The one rule with no Webex counterpart is the CREDENTIAL BINDING check in PUT
// (security review F2) — see the handler.

import { Router } from 'express';
import { Role } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireRole } from '../middleware/auth';
import { updateJiraSettingsSchema } from '../utils/validation';
import { encrypt } from '../utils/secretbox';
import {
  JIRA_SETTINGS_DEFAULTS,
  JIRA_SETTINGS_SINGLETON,
  isValidJiraCloudId,
  jiraBaseUrlEnvOverrideActive,
  type JiraSettingsRecord,
} from '../config/jira';
import { testJiraConnection, listJiraProjects, resolveJiraCloudId } from '../utils/jira';

const router = Router();

/**
 * Resolve the cloud id for `siteBaseUrl` and persist it — but only onto a document
 * whose baseUrl is STILL the URL the id was resolved for. The compare-and-set (an
 * updateMany whose where carries the baseUrl, not just the singleton key) is what
 * guards the deep-review races: a save that changes the base URL during the up-to-
 * 10s resolution round-trip must never receive the OLD site's id (a lasting
 * wrong-tenant binding otherwise invisible to the admin), and the fire-and-forget
 * PUT path must never clobber a newer configuration. A failed resolution persists
 * nothing (the stored id — or the site-origin fallback — stays in place). NEVER
 * throws: both callers run it best-effort, one of them with no await at all.
 */
async function resolveAndBindCloudId(siteBaseUrl: string): Promise<void> {
  try {
    const cloudId = await resolveJiraCloudId(siteBaseUrl);
    if (cloudId === null) return;
    await prisma.jiraSettings.updateMany({
      where: { singleton: JIRA_SETTINGS_SINGLETON, baseUrl: siteBaseUrl },
      data: { cloudId },
    });
  } catch (error) {
    console.error(
      'Error persisting resolved jira cloud id:',
      error instanceof Error ? error.message : String(error)
    );
  }
}

// The last background-sync outcome, as the admin page consumes it:
//   { ok: true, at }                    -> the poller is healthy (since `at`)
//   { ok: false, reason, at }           -> it has been failing since `at`
//   null                                -> nothing recorded yet (never polled)
// `at` is when that state was ENTERED, not the last attempt (the poller writes on
// transition only — see prisma/schema.prisma), which is what makes "failing since
// ..." truthful. `reason` is one of the CLOSED JiraFailureReason codes, so this
// carries no upstream error text (F9) — the FE maps it through the same
// jiraSettings.testReason.* catalog as the connection test.
function serializeLastSync(s: JiraSettingsRecord) {
  // Both halves must be present to describe a state: a status without its timestamp
  // (a hand-edited document) is treated as "nothing recorded".
  if (typeof s.lastSyncOk !== 'boolean' || !s.lastSyncAt) return null;
  return {
    ok: s.lastSyncOk,
    // Omitted while healthy — a success clears the stored reason anyway.
    ...(s.lastSyncReason ? { reason: s.lastSyncReason } : {}),
    at: s.lastSyncAt,
  };
}

// The subset of a JiraSettings document (or the in-code defaults) that leaves the
// server. CRITICAL: `apiTokenEnc`/the plaintext token are omitted; only a
// `hasToken` boolean is exposed so the ciphertext (and of course the secret) never
// travels over the wire or into a client store. Everything else is admin-authored
// configuration the admin page needs to render, plus the read-only `lastSync`
// health block the poller writes (never accepted as input — PUT's payload cannot
// contain it, so an admin save can neither set nor clear the poller's verdict).
function serializeJiraSettings(record: JiraSettingsRecord | null) {
  const s = record ?? JIRA_SETTINGS_DEFAULTS;
  return {
    enabled: s.enabled,
    baseUrl: s.baseUrl,
    email: s.email,
    defaultProjectKey: s.defaultProjectKey,
    issueTypeName: s.issueTypeName,
    pollIntervalMinutes: s.pollIntervalMinutes,
    cancelResolutions: s.cancelResolutions,
    hasToken: (s.apiTokenEnc ?? '').length > 0,
    lastSync: serializeLastSync(s),
  };
}

// GET the current (masked) settings, or the in-code defaults when none saved yet.
router.get('/', requireRole(Role.ADMIN), async (req, res) => {
  try {
    const doc = await prisma.jiraSettings.findUnique({ where: { singleton: JIRA_SETTINGS_SINGLETON } });
    res.json(serializeJiraSettings(doc));
  } catch (error) {
    console.error('Error fetching jira settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /projects: list the Jira projects the configured tech user can see, powering
// the admin's default-project picker (and the per-department override picker).
// Delivery is best-effort, so this ALWAYS responds 200 with a
// { projects: JiraProject[]; reason?: JiraFailureReason } shape: on success
// `projects` is the listing and `reason` is absent; on ANY failure — not configured,
// or an HTTP/transport error — `projects` is [] and `reason` is a FIXED category, so
// the FE can render the picker when it loads yet always fall back to manual key
// entry. CRITICAL: the API token is a credential only and is NEVER part of the
// response; the full error stays in the server log. Exactly mirrors
// GET /api/webex-settings/rooms (including being a read-only admin probe outside the
// CSRF check, which only guards state-changing methods).
router.get('/projects', requireRole(Role.ADMIN), async (req, res) => {
  try {
    const result = await listJiraProjects();
    if (result.ok) {
      res.json({ projects: result.projects });
    } else {
      res.json({ projects: [], reason: result.reason });
    }
  } catch (error) {
    // listJiraProjects() is documented never-throws, so this is defensive only. It
    // still answers 200 with the SAME { projects, reason } shape rather than the
    // house 500/{ error } fallback: the always-200 contract is what the picker codes
    // against. The full error is logged.
    console.error('Error listing jira projects:', error);
    res.json({ projects: [], reason: 'unknown' });
  }
});

// PUT: save the singleton. Token keep/set/wipe rules mirror the Webex bot token.
// Like Webex there is no save-time enabled-requires-X guard: a deployment marked
// enabled without a usable base URL/email/token simply degrades to not effectively
// enabled via getEffectiveJiraConfig(), and the dispatch endpoint refuses with a
// clear 400 instead of the save failing.
router.put('/', requireRole(Role.ADMIN), async (req, res) => {
  // House validation pattern: safeParse and surface ONLY the first concise issue
  // message, never the whole ZodError dump. A non-Zod failure (DB write, encrypt
  // throw) is handled by the write try/catch below and returns 500.
  const parsed = updateJiraSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const data = parsed.data;

  try {
    const existing = await prisma.jiraSettings.findUnique({ where: { singleton: JIRA_SETTINGS_SINGLETON } });

    // Does this save INTEND to change the stored token? TRUE whenever an `apiToken`
    // field is present at all — a SET (a new non-empty token) or a WIPE (an empty
    // string). FALSE in the KEEP case (no `apiToken` field).
    const changesToken = data.apiToken !== undefined;

    // ---------------------------------------------------------------------
    // CREDENTIAL BINDING (security review F2).
    //
    // The stored token is only ever sent to the stored baseUrl, as Basic auth for
    // the stored email. If a save could change baseUrl (or email) while KEEPING the
    // token, an admin — or anyone who reached this endpoint — could silently
    // re-point an existing credential at a host of their choosing and have the
    // server hand it over on the next poll tick. So: when this save changes either
    // identity field, it MUST also SET a new token or WIPE the old one.
    //
    // The rule is scoped to the case where a credential actually EXISTS to
    // re-target: with no stored token, "keep" keeps nothing and the save is
    // harmless (this is also the ordinary first-configuration save, where the admin
    // fills the URL/email before pasting the token). Wiping is accepted because it
    // leaves nothing to leak.
    // ---------------------------------------------------------------------
    const storedHasToken = (existing?.apiTokenEnc ?? '').length > 0;
    const identityChanged =
      data.baseUrl !== (existing?.baseUrl ?? JIRA_SETTINGS_DEFAULTS.baseUrl) ||
      data.email !== (existing?.email ?? JIRA_SETTINGS_DEFAULTS.email);
    if (identityChanged && storedHasToken && !changesToken) {
      return res.status(400).json({
        error:
          'Changing the Jira base URL or account email requires re-entering the API token (or clearing it).',
      });
    }

    // Token ciphertext to persist. The upsert UPDATE OMITS apiTokenEnc in the KEEP
    // case to avoid clobbering a concurrent change (see below): there this value is
    // only whatever was read at the top of THIS request and is NOT written back.
    //   - apiToken absent            -> keep whatever is already stored
    //   - apiToken present+non-empty -> encrypt and store the new secret
    //   - apiToken present+empty     -> wipe any stored token
    // The schema already trimmed a real token and rejected a whitespace-only one.
    let apiTokenEnc: string;
    if (data.apiToken === undefined) {
      apiTokenEnc = existing?.apiTokenEnc ?? '';
    } else if (data.apiToken.length > 0) {
      apiTokenEnc = encrypt(data.apiToken);
    } else {
      apiTokenEnc = '';
    }

    // ---------------------------------------------------------------------
    // CLOUD ID (scoped-API-token support).
    //
    // Scoped Atlassian API tokens only authenticate against the
    // api.atlassian.com/ex/jira/{cloudId} gateway, so the site's cloud id is
    // resolved from the site's PUBLIC, unauthenticated /_edge/tenant_info endpoint
    // and stored alongside the settings. Best-effort: while it is null, outbound
    // calls fall back to the site origin (classic unscoped tokens keep working).
    //
    // The synchronous part below only KEEPS or DISCARDS: a shape-valid stored id
    // survives while the base URL is unchanged; a CHANGED base URL always discards
    // it (it identified the OLD site). Resolution itself runs AFTER the upsert
    // commits, fire-and-forget (see resolveAndBindCloudId + the trigger after
    // res.json). It must NOT be awaited here: an awaited network round-trip would
    // sit inside the F2 read→write section and stretch its race window from
    // sub-millisecond to ~10 attacker-stretchable seconds — long enough for a
    // concurrent save to store a token that this request's stale snapshot would
    // then silently re-target (deep-review P1).
    // ---------------------------------------------------------------------
    let cloudId = isValidJiraCloudId(existing?.cloudId) ? (existing!.cloudId as string) : null;
    if (data.baseUrl !== (existing?.baseUrl ?? JIRA_SETTINGS_DEFAULTS.baseUrl)) cloudId = null;

    const values = {
      enabled: data.enabled,
      baseUrl: data.baseUrl,
      cloudId,
      email: data.email,
      apiTokenEnc,
      defaultProjectKey: data.defaultProjectKey,
      issueTypeName: data.issueTypeName,
      pollIntervalMinutes: data.pollIntervalMinutes,
      cancelResolutions: data.cancelResolutions,
    };

    // The UPDATE payload is every field EXCEPT apiTokenEnc, with apiTokenEnc added
    // back ONLY when this request changes it (SET or WIPE). Omitting it in the KEEP
    // case leaves the stored ciphertext untouched (Prisma skips omitted fields), so
    // a token another admin changed between our read and our write is NOT clobbered
    // (a lost update). CREATE always writes the full `values`.
    const { apiTokenEnc: _omitApiTokenEnc, ...valuesWithoutToken } = values;
    const updateValues = {
      ...valuesWithoutToken,
      ...(changesToken ? { apiTokenEnc } : {}),
    };

    // Atomic singleton write: upsert on the DB-enforced unique `singleton` key so
    // two concurrent first-saves converge to exactly ONE document. On a lost race
    // the loser's create hits Prisma's unique-constraint error P2002; the catch
    // below re-reads the winner and returns it with 200. `singleton` is set by its
    // schema default on create and left untouched on update.
    const saved = await prisma.jiraSettings.upsert({
      where: { singleton: JIRA_SETTINGS_SINGLETON },
      create: values,
      update: updateValues,
    });

    res.json(serializeJiraSettings(saved));

    // Post-commit resolution trigger (see the CLOUD ID comment above). Gated on
    // `enabled` so a disabled, pre-staged configuration never opens a socket —
    // the save that later flips `enabled` on re-triggers this — and on the
    // JIRA_API_BASE_URL override, under which every call targets the e2e mock and
    // a gateway id would be meaningless.
    if (cloudId === null && data.enabled && data.baseUrl.length > 0 && !jiraBaseUrlEnvOverrideActive()) {
      void resolveAndBindCloudId(data.baseUrl);
    }
  } catch (error) {
    // Convergence on a lost first-save race: a concurrent creator won the unique
    // `singleton` key and this request's create hit P2002. The one document already
    // exists, so re-read it and return it with 200 — through the SAME masked
    // serializer, so the stored `apiTokenEnc` is NEVER exposed — instead of a
    // spurious 500. A null re-read or a re-read that itself fails falls through to
    // the 500, and any NON-P2002 error keeps the existing 500 behavior.
    if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002') {
      try {
        const reread = await prisma.jiraSettings.findUnique({
          where: { singleton: JIRA_SETTINGS_SINGLETON },
        });
        if (reread) {
          return res.json(serializeJiraSettings(reread));
        }
      } catch (rereadError) {
        console.error('Error re-reading jira settings after concurrent create (P2002):', rereadError);
      }
    }
    // A non-Zod failure (DB write, encrypt) is a server error — never a 400.
    //
    // Only the error MESSAGE is logged, never the error OBJECT (F9). This is the one
    // handler in the app whose in-flight values include `apiTokenEnc`, and a failing
    // client can attach a lot to an error: a Prisma validation error, for instance,
    // renders the rejected `data` payload into its own message-carrying object graph,
    // which would put the token ciphertext into the log. The message alone still
    // identifies the failure, and the stack adds nothing here (the throw site is this
    // one upsert).
    console.error(
      'Error saving jira settings:',
      error instanceof Error ? error.message : String(error)
    );
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /test: probe the SAVED settings (GET /rest/api/3/myself — the cheapest call
// that proves base URL + credential). The probe is best-effort, so this ALWAYS
// responds 200; the structured result's `ok` field carries the outcome and an
// `ok: false` result includes a FIXED reason CATEGORY the admin UI translates.
// CRITICAL: the reason is one of a closed set of enum codes and NEVER contains any
// config- or error-derived text, so neither the token nor an upstream error body can
// leak here (the full error stays in the server log). Takes no request body — unlike
// the mail/Webex test sends there is no recipient to name.
router.post('/test', requireRole(Role.ADMIN), async (req, res) => {
  try {
    // Cloud-id REFRESH, before the probe so the probe exercises exactly the
    // routing the dispatch endpoint and the poller will use. It re-resolves even
    // over a valid-LOOKING stored id, which makes the Test button the one-click
    // remediation for a STALE id (an Atlassian site deleted and re-created under
    // the same URL rotates its cloud id server-side); a failed resolution
    // persists nothing, so a transient hiccup never clears a working id. Skipped
    // for a disabled configuration (the probe answers config_error with no
    // network call — resolving first would be a socket for nothing) and under
    // the JIRA_API_BASE_URL override (every call targets the e2e mock).
    //
    // In its OWN try/catch: this route's contract is "ALWAYS 200 with a closed
    // reason code" (the FE codes against it), so a DB error in the refresh must
    // degrade to probing with the stored routing, never to a 500.
    try {
      if (!jiraBaseUrlEnvOverrideActive()) {
        const doc = await prisma.jiraSettings.findUnique({ where: { singleton: JIRA_SETTINGS_SINGLETON } });
        if (doc && doc.enabled && doc.baseUrl.length > 0) {
          await resolveAndBindCloudId(doc.baseUrl);
        }
      }
    } catch (error) {
      console.error(
        'Error refreshing jira cloud id before the connection test:',
        error instanceof Error ? error.message : String(error)
      );
    }

    const result = await testJiraConnection();
    res.json(result);
  } catch (error) {
    console.error('Error testing jira connection:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
