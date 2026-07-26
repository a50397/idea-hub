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

// The constant value of the DB-enforced unique `singleton` discriminator (see
// prisma/schema.prisma). The PUT write upserts on this key so the collection holds
// at most one document even under concurrent first-saves.
const SINGLETON_KEY = 'singleton';

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
  // House validation pattern (routes/ideas.ts / reports.ts): safeParse and surface
  // ONLY the first concise issue message, never the whole ZodError dump. A non-Zod
  // failure (DB write, encrypt throw) is handled by the write try/catch below and
  // returns 500 — it must never be reported as a 400 validation error.
  const parsed = updateMailSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const data = parsed.data;

  // Save-time validation (replaces the removed #8 boot guard): a deployment must
  // not be marked enabled without a host, or it would "work" yet send nowhere.
  // This is a client error, so it returns 400 BEFORE the write try/catch.
  if (data.enabled && data.host.length === 0) {
    return res
      .status(400)
      .json({ error: 'An SMTP host is required when outbound email is enabled' });
  }

  try {
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

    // Atomic singleton write: upsert on the DB-enforced unique `singleton` key so
    // two concurrent first-saves converge to exactly ONE document. The unique index
    // guarantees the invariant even when both requests race to create — the loser
    // fails the constraint instead of inserting a duplicate, non-healing config doc.
    // `singleton` is set by its schema default on create and left untouched on
    // update, so it never appears in `values`.
    const saved = await prisma.mailSettings.upsert({
      where: { singleton: SINGLETON_KEY },
      create: values,
      update: values,
    });

    res.json(serializeMailSettings(saved));
  } catch (error) {
    // A non-Zod failure (DB write, encrypt) is a server error — never a 400.
    console.error('Error saving mail settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /test: send a short message with the SAVED settings. Delivery is
// best-effort, so this always responds 200 and reports sendMail's boolean as
// `ok` (false = not delivered, e.g. a dead relay or disabled config's failure) —
// the boolean IS the feedback the admin UI surfaces.
router.post('/test', requireRole(Role.ADMIN), async (req, res) => {
  // Same house pattern: concise first-issue 400 on validation failure; a non-Zod
  // failure returns 500 (sendMail is best-effort and never throws, so the catch is
  // defensive but keeps the shape consistent).
  const parsed = mailTestSendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { to } = parsed.data;

  try {
    const ok = await sendMail({
      to,
      subject: '[IdeaHub] Test email',
      text: 'This is a test email from IdeaHub to verify your outbound mail settings.',
    });
    res.json({ ok });
  } catch (error) {
    console.error('Error sending test mail:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
