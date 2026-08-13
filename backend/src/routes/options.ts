// Consolidated FE-facing runtime flags for the authenticated SPA.
//
//   GET /api/options -> { mailEnabled, webexEnabled, jiraEnabled, ssoShowLogout }
//                       for ANY authenticated user
//                    -> ... + { jiraSyncFailing } for an ADMIN session ONLY
//
// This is the single authenticated source of session-scoped UI flags the SPA reads
// at runtime, whether they are DB-derived (mailEnabled, webexEnabled, jiraEnabled)
// or env-derived (ssoShowLogout). The PUBLIC GET /api/auth/config deliberately
// carries ONLY what the pre-login page needs (ssoEnabled); every flag that requires
// a session lives here instead. The response is EXACTLY these booleans — no
// host/username/token/base-URL/other configuration and no other environment value —
// so no config or secret can leak.
//
// ROLE-GATED EXCEPTION to the "same flags for everyone" contract: `jiraSyncFailing`
// is present ONLY in an ADMIN response and absent (not `false`) for every other
// role. It reports that the Jira background poller is currently failing, which is
// operational health of an admin-managed integration — the same class of
// information as the admin-only settings page, and useless to a USER who cannot act
// on it. This endpoint is nevertheless its home, by project convention: FE runtime
// flags live here rather than in a new endpoint, so the SPA keeps one flag read.
// Absence (rather than `false`) is deliberate — it keeps the non-admin response byte
// for byte what it was, and the store's `?? false` fallback reads it as "not
// failing" without ever revealing that a flag exists.

import { Router } from 'express';
import { Role } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { getEffectiveMailConfig } from '../config/mail';
import { getEffectiveWebexConfig } from '../utils/webex';
import { getEffectiveJiraConfig, getJiraSettingsRecord } from '../config/jira';
import { isSsoLogoutVisible } from '../config/sso';

const router = Router();

// GET the runtime UI flags for the authenticated SPA (requireAuth — any logged-in
// user). `mailEnabled`/`webexEnabled`/`jiraEnabled` mirror each channel's
// effective-enabled state (mail: enabled AND a host; webex: enabled AND a usable
// token; jira: enabled AND a base URL AND an account email AND a usable token — the
// same derivation each caller keys off), so the per-idea notify toggle and the
// "Create Jira task" button can decide their own visibility without seeing the admin
// configuration. `ssoShowLogout` re-exposes the in-app logout button for SSO users
// (SSO_SHOW_LOGOUT). The three channel reads are independent, so a failure in any of
// them surfaces as the route's generic 500.
router.get('/', requireAuth, async (req, res) => {
  try {
    // The status read is ADMIN-only work: for every other role it is neither
    // returned nor performed, so the ordinary user's request keeps doing exactly the
    // three channel reads it always did.
    const isAdmin = req.session.role === Role.ADMIN;
    const [mail, webex, jira, jiraStatus] = await Promise.all([
      getEffectiveMailConfig(),
      getEffectiveWebexConfig(),
      getEffectiveJiraConfig(),
      isAdmin ? getJiraSettingsRecord() : Promise.resolve(null),
    ]);
    res.json({
      mailEnabled: mail.effectiveEnabled,
      webexEnabled: webex.effectiveEnabled,
      jiraEnabled: jira.effectiveEnabled,
      ssoShowLogout: isSsoLogoutVisible(),
      // ADMIN only (see the role-gated exception in the module header). Both halves
      // come from the SAME settings snapshot, so the flag is always self-consistent:
      // `enabled` (the admin's intent — NOT effectiveEnabled, which an undecryptable
      // token would already have turned off, hiding the very failure being reported)
      // AND a recorded failing outcome. `lastSyncOk === false` also keeps "never
      // recorded" (null) out of the banner.
      ...(jiraStatus ? { jiraSyncFailing: jiraStatus.enabled && jiraStatus.lastSyncOk === false } : {}),
    });
  } catch (error) {
    console.error('Error fetching options:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
