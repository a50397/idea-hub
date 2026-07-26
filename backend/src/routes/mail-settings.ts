// Admin-only management of the singleton outbound-mail configuration.
//
//   GET  /api/mail-settings       -> masked settings + hasPassword (no ciphertext)
//   PUT  /api/mail-settings       -> save (upsert) the single document
//   POST /api/mail-settings/test  -> send a short test mail using the SAVED config
//
// All three require an ADMIN session (requireRole). The stored password is
// AES-256-GCM ciphertext (utils/secretbox.ts) and is NEVER returned by any
// endpoint — the GET/PUT responses expose only a `hasPassword` boolean. State-
// changing requests (PUT, POST) are additionally covered by the app-wide CSRF
// header check registered in index.ts (they are not GET/HEAD/OPTIONS).

import { Router } from 'express';
import { Role } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireRole } from '../middleware/auth';
import { updateMailSettingsSchema, mailTestSendSchema } from '../utils/validation';
import { encrypt } from '../utils/secretbox';
import { sendMail } from '../utils/mailer';
import { MAIL_SETTINGS_DEFAULTS, type MailSettingsRecord } from '../config/mail';

const router = Router();

// The subset of a MailSettings document (or the in-code defaults) that leaves the
// server. CRITICAL: `passwordEnc`/`password` are omitted; only a `hasPassword`
// boolean is exposed so the ciphertext (and of course the plaintext) never travels
// over the wire or into a client store.
function serializeMailSettings(record: MailSettingsRecord | null) {
  const s = record ?? MAIL_SETTINGS_DEFAULTS;
  return {
    enabled: s.enabled,
    host: s.host,
    port: s.port,
    secure: s.secure,
    username: s.username,
    from: s.from,
    language: s.language,
    subjectTemplate: s.subjectTemplate,
    hasPassword: (s.passwordEnc ?? '').length > 0,
  };
}

// GET the current (masked) settings, or the in-code defaults when none saved yet.
router.get('/', requireRole(Role.ADMIN), async (req, res) => {
  try {
    const doc = await prisma.mailSettings.findFirst();
    res.json(serializeMailSettings(doc));
  } catch (error) {
    console.error('Error fetching mail settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT: save the singleton. Password keep/set/wipe rules (see below) plus the
// save-time enabled-requires-host guard that replaces the old boot guard.
router.put('/', requireRole(Role.ADMIN), async (req, res) => {
  try {
    const data = updateMailSettingsSchema.parse(req.body);

    // Save-time validation (replaces the removed #8 boot guard): a deployment must
    // not be marked enabled without a host, or it would "work" yet send nowhere.
    if (data.enabled && data.host.length === 0) {
      return res
        .status(400)
        .json({ error: 'An SMTP host is required when outbound email is enabled' });
    }

    const existing = await prisma.mailSettings.findFirst();

    // Password ciphertext to persist:
    //   - username saved empty  -> wipe any stored password (no auth without a user)
    //   - password present+non-empty -> encrypt and store the new secret
    //   - password absent/empty -> keep whatever is already stored
    let passwordEnc: string;
    if (data.username.length === 0) {
      passwordEnc = '';
    } else if (data.password !== undefined && data.password.length > 0) {
      passwordEnc = encrypt(data.password);
    } else {
      passwordEnc = existing?.passwordEnc ?? '';
    }

    const values = {
      enabled: data.enabled,
      host: data.host,
      port: data.port,
      secure: data.secure,
      username: data.username,
      passwordEnc,
      from: data.from,
      language: data.language,
      subjectTemplate: data.subjectTemplate,
    };

    // Singleton upsert without a synthetic unique key: update the existing doc or
    // create the first one (mirrors the findFirst + create/update house pattern).
    const saved = existing
      ? await prisma.mailSettings.update({ where: { id: existing.id }, data: values })
      : await prisma.mailSettings.create({ data: values });

    res.json(serializeMailSettings(saved));
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// POST /test: send a short message with the SAVED settings. Delivery is
// best-effort, so this always responds 200 and reports sendMail's boolean as
// `ok` (false = not delivered, e.g. a dead relay or disabled config's failure) —
// the boolean IS the feedback the admin UI surfaces.
router.post('/test', requireRole(Role.ADMIN), async (req, res) => {
  try {
    const { to } = mailTestSendSchema.parse(req.body);
    const ok = await sendMail({
      to,
      subject: '[IdeaHub] Test email',
      text: 'This is a test email from IdeaHub to verify your outbound mail settings.',
    });
    res.json({ ok });
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

export default router;
