// Consolidated FE-facing runtime flags for the authenticated SPA.
//
//   GET /api/options -> { mailEnabled, ssoShowLogout } for ANY authenticated user
//
// This is the single authenticated source of session-scoped UI flags the SPA reads
// at runtime, whether they are DB-derived (mailEnabled) or env-derived
// (ssoShowLogout). The PUBLIC GET /api/auth/config deliberately carries ONLY what
// the pre-login page needs (ssoEnabled); every flag that requires a session lives
// here instead. The response is EXACTLY these two booleans — no host/username/other
// configuration and no other environment value — so no config or secret can leak.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getEffectiveMailConfig } from '../config/mail';
import { isSsoLogoutVisible } from '../config/sso';

const router = Router();

// GET the runtime UI flags for the authenticated SPA (requireAuth — any logged-in
// user). `mailEnabled` mirrors the effective mail-enabled state (enabled AND a host
// configured — the same derivation the mailer keys off), so the per-idea notify
// toggle can decide its own visibility without seeing the admin configuration.
// `ssoShowLogout` re-exposes the in-app logout button for SSO users (SSO_SHOW_LOGOUT).
router.get('/', requireAuth, async (req, res) => {
  try {
    const mail = await getEffectiveMailConfig();
    res.json({
      mailEnabled: mail.effectiveEnabled,
      ssoShowLogout: isSsoLogoutVisible(),
    });
  } catch (error) {
    console.error('Error fetching options:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
