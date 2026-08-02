// Consolidated FE-facing runtime flags for the authenticated SPA.
//
//   GET /api/options -> { mailEnabled, webexEnabled, ssoShowLogout } for ANY authenticated user
//
// This is the single authenticated source of session-scoped UI flags the SPA reads
// at runtime, whether they are DB-derived (mailEnabled, webexEnabled) or env-derived
// (ssoShowLogout). The PUBLIC GET /api/auth/config deliberately carries ONLY what
// the pre-login page needs (ssoEnabled); every flag that requires a session lives
// here instead. The response is EXACTLY these booleans — no host/username/token/other
// configuration and no other environment value — so no config or secret can leak.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getEffectiveMailConfig } from '../config/mail';
import { getEffectiveWebexConfig } from '../utils/webex';
import { isSsoLogoutVisible } from '../config/sso';

const router = Router();

// GET the runtime UI flags for the authenticated SPA (requireAuth — any logged-in
// user). `mailEnabled`/`webexEnabled` mirror each channel's effective-enabled state
// (mail: enabled AND a host; webex: enabled AND a usable token — the same derivation
// each sender keys off), so the per-idea notify toggle can decide its own visibility
// without seeing the admin configuration. `ssoShowLogout` re-exposes the in-app
// logout button for SSO users (SSO_SHOW_LOGOUT). The two channel reads are
// independent, so a failure in either surfaces as the route's generic 500.
router.get('/', requireAuth, async (req, res) => {
  try {
    const [mail, webex] = await Promise.all([getEffectiveMailConfig(), getEffectiveWebexConfig()]);
    res.json({
      mailEnabled: mail.effectiveEnabled,
      webexEnabled: webex.effectiveEnabled,
      ssoShowLogout: isSsoLogoutVisible(),
    });
  } catch (error) {
    console.error('Error fetching options:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
