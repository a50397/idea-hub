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
import { sendTestMail } from '../utils/mailer';
import { MAIL_SETTINGS_DEFAULTS, MAIL_SETTINGS_SINGLETON, type MailSettingsRecord } from '../config/mail';

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
    const doc = await prisma.mailSettings.findUnique({ where: { singleton: MAIL_SETTINGS_SINGLETON } });
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
    const existing = await prisma.mailSettings.findUnique({ where: { singleton: MAIL_SETTINGS_SINGLETON } });

    // Does this save INTEND to change the stored password? TRUE on a WIPE (username
    // saved empty -> drop the secret) or a SET (a new non-empty password); FALSE in
    // the KEEP case (a username with no new password). This flag gates whether the
    // upsert UPDATE writes passwordEnc at all — see the upsert below.
    const changesPassword =
      data.username.length === 0 || (data.password !== undefined && data.password.length > 0);

    // Password ciphertext to persist. The upsert UPDATE OMITS passwordEnc in the KEEP
    // case to avoid clobbering a concurrent change (see below): there this value is
    // only the ciphertext read at the top of THIS request and is NOT written back.
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

    // The UPDATE payload is every field EXCEPT passwordEnc, with passwordEnc added
    // back ONLY when this request changes it (SET or WIPE). Omitting it in the KEEP
    // case leaves the stored ciphertext untouched (Prisma skips omitted fields), so a
    // password another admin changed between our read and our write is NOT clobbered
    // (a lost update). CREATE always writes the full `values` (see below).
    const { passwordEnc: _omitPasswordEnc, ...valuesWithoutPassword } = values;
    const updateValues = {
      ...valuesWithoutPassword,
      ...(changesPassword ? { passwordEnc } : {}),
    };

    // Atomic singleton write: upsert on the DB-enforced unique `singleton` key so
    // two concurrent first-saves converge to exactly ONE document. The unique index
    // guarantees the invariant even when both requests race to create — the loser
    // fails the unique constraint (Prisma error P2002) instead of inserting a
    // duplicate, non-healing config doc. On that P2002 the winner has ALREADY
    // persisted the singleton, so the loser re-reads it and returns the persisted
    // document with 200 (see the catch below): both concurrent callers converge
    // cleanly rather than the loser receiving a misleading 500. `singleton` is set by
    // its schema default on create and left untouched on update, so it never appears
    // in `values`. CREATE always writes the full `values` (with passwordEnc): the
    // first-ever save has no stored value to clobber and the column is non-null.
    const saved = await prisma.mailSettings.upsert({
      where: { singleton: MAIL_SETTINGS_SINGLETON },
      create: values,
      update: updateValues,
    });

    res.json(serializeMailSettings(saved));
  } catch (error) {
    // Convergence on a lost first-save race: a concurrent creator won the unique
    // `singleton` key and this request's create hit P2002. The one document already
    // exists, so re-read it and return it with 200 — through the SAME masked
    // serializer the normal path uses, so the stored `passwordEnc` is NEVER exposed —
    // instead of a spurious 500. P2002 is detected with the repo's duck-typed `.code`
    // check (mirrors the routes/departments.ts duplicate-name path). A null re-read
    // (should not happen after a P2002) or a re-read that itself fails falls through
    // to the existing 500, and any NON-P2002 error keeps the existing 500 behavior.
    if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002') {
      try {
        const reread = await prisma.mailSettings.findUnique({
          where: { singleton: MAIL_SETTINGS_SINGLETON },
        });
        if (reread) {
          return res.json(serializeMailSettings(reread));
        }
      } catch (rereadError) {
        console.error('Error re-reading mail settings after concurrent create (P2002):', rereadError);
      }
    }
    // A non-Zod failure (DB write, encrypt) is a server error — never a 400.
    console.error('Error saving mail settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /test: send a short message with the SAVED settings. Delivery is
// best-effort, so this ALWAYS responds 200; the structured MailTestResult's
// `status` field carries the outcome ('sent' | 'disabled' | 'failed'), and a
// 'failed' result includes a FIXED reason CATEGORY the admin UI translates.
// CRITICAL: the reason is one of a closed set of enum codes and NEVER contains
// any config- or error-derived text, so no SMTP secret can leak here (the full
// error stays in the server log). See utils/mailer.ts sendTestMail().
router.post('/test', requireRole(Role.ADMIN), async (req, res) => {
  // Same house pattern: concise first-issue 400 on validation failure; a non-Zod
  // failure returns 500 (sendTestMail is best-effort and never throws, so the catch
  // is defensive but keeps the shape consistent).
  const parsed = mailTestSendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { to } = parsed.data;

  try {
    const result = await sendTestMail(to);
    res.json(result);
  } catch (error) {
    console.error('Error sending test mail:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
