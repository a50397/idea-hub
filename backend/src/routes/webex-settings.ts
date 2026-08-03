// Admin-only management of the singleton Webex notification configuration. The
// exact structural mirror of routes/mail-settings.ts for the second channel.
//
//   GET  /api/webex-settings         -> masked settings + hasToken (no ciphertext)
//   PUT  /api/webex-settings         -> save (upsert) the single document
//   POST /api/webex-settings/test    -> send a short test DM using the SAVED config
//   GET  /api/webex-settings/rooms   -> list the rooms/spaces the bot belongs to
//
// Every route requires an ADMIN session (requireRole). The effective webex-enabled
// boolean any authenticated user needs (to drive UI) lives on GET /api/options
// (routes/options.ts), not here. The stored bot token is AES-256-GCM ciphertext
// (utils/secretbox.ts, same MAIL_SETTINGS_KEY as the SMTP password) and is NEVER
// returned by any endpoint — the GET/PUT responses expose only a `hasToken`
// boolean. State-changing requests (PUT, POST) are additionally covered by the
// app-wide CSRF header check registered in index.ts.

import { Router } from 'express';
import { Role } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireRole } from '../middleware/auth';
import { updateWebexSettingsSchema, webexTestSendSchema } from '../utils/validation';
import { encrypt } from '../utils/secretbox';
import {
  sendTestWebexMessage,
  listWebexRooms,
  WEBEX_SETTINGS_DEFAULTS,
  WEBEX_SETTINGS_SINGLETON,
  type WebexSettingsRecord,
} from '../utils/webex';

const router = Router();

// The subset of a WebexSettings document (or the in-code defaults) that leaves the
// server. CRITICAL: `botTokenEnc`/`token` are omitted; only a `hasToken` boolean is
// exposed so the ciphertext (and of course the plaintext) never travels over the
// wire or into a client store.
function serializeWebexSettings(record: WebexSettingsRecord | null) {
  const s = record ?? WEBEX_SETTINGS_DEFAULTS;
  return {
    enabled: s.enabled,
    language: s.language,
    hasToken: (s.botTokenEnc ?? '').length > 0,
  };
}

// GET the current (masked) settings, or the in-code defaults when none saved yet.
router.get('/', requireRole(Role.ADMIN), async (req, res) => {
  try {
    const doc = await prisma.webexSettings.findUnique({ where: { singleton: WEBEX_SETTINGS_SINGLETON } });
    res.json(serializeWebexSettings(doc));
  } catch (error) {
    console.error('Error fetching webex settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /rooms: list the rooms/spaces the bot belongs to, powering the admin room
// picker. Delivery is best-effort, so this ALWAYS responds 200 with a
// { rooms: WebexRoom[]; reason?: WebexFailureReason } shape: on success `rooms` is
// the listing and `reason` is absent; on ANY failure — not configured, or an
// HTTP/transport error — `rooms` is [] and `reason` is a FIXED category, so the FE
// can render the picker when rooms load yet always fall back to manual room-id
// entry. CRITICAL: the bot token is the Bearer credential only and is NEVER part of
// the response (neither the rooms nor the reason carry it); the full error stays in
// the server log. See utils/webex.ts listWebexRooms().
router.get('/rooms', requireRole(Role.ADMIN), async (req, res) => {
  try {
    const result = await listWebexRooms();
    if (result.ok) {
      res.json({ rooms: result.rooms });
    } else {
      res.json({ rooms: [], reason: result.reason });
    }
  } catch (error) {
    console.error('Error listing webex rooms:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT: save the singleton. Token keep/set/wipe rules mirror the mail password
// (see below). Unlike mail there is no host-equivalent required field, so there is
// no save-time enabled-requires-host guard: a deployment marked enabled without an
// effective token simply degrades to disabled/log-only via getEffectiveWebexConfig
// (effectiveEnabled = enabled && token), exactly as mail's effective check does.
router.put('/', requireRole(Role.ADMIN), async (req, res) => {
  // House validation pattern: safeParse and surface ONLY the first concise issue
  // message, never the whole ZodError dump. A non-Zod failure (DB write, encrypt
  // throw) is handled by the write try/catch below and returns 500.
  const parsed = updateWebexSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const data = parsed.data;

  try {
    const existing = await prisma.webexSettings.findUnique({ where: { singleton: WEBEX_SETTINGS_SINGLETON } });

    // Does this save INTEND to change the stored token? TRUE whenever a `token`
    // field is present at all — a SET (a new non-empty token) or a WIPE (an empty
    // string). FALSE in the KEEP case (no `token` field). This flag gates whether
    // the upsert UPDATE writes botTokenEnc at all — see the upsert below.
    const changesToken = data.token !== undefined;

    // Token ciphertext to persist. The upsert UPDATE OMITS botTokenEnc in the KEEP
    // case to avoid clobbering a concurrent change (see below): there this value is
    // only whatever was read at the top of THIS request and is NOT written back.
    //   - token absent            -> keep whatever is already stored
    //   - token present+non-empty -> encrypt and store the new secret
    //   - token present+empty     -> wipe any stored token
    // The schema already trimmed a real token and rejected a whitespace-only one.
    let botTokenEnc: string;
    if (data.token === undefined) {
      botTokenEnc = existing?.botTokenEnc ?? '';
    } else if (data.token.length > 0) {
      botTokenEnc = encrypt(data.token);
    } else {
      botTokenEnc = '';
    }

    const values = {
      enabled: data.enabled,
      botTokenEnc,
      language: data.language,
    };

    // The UPDATE payload is every field EXCEPT botTokenEnc, with botTokenEnc added
    // back ONLY when this request changes it (SET or WIPE). Omitting it in the KEEP
    // case leaves the stored ciphertext untouched (Prisma skips omitted fields), so
    // a token another admin changed between our read and our write is NOT clobbered
    // (a lost update). CREATE always writes the full `values`.
    const { botTokenEnc: _omitBotTokenEnc, ...valuesWithoutToken } = values;
    const updateValues = {
      ...valuesWithoutToken,
      ...(changesToken ? { botTokenEnc } : {}),
    };

    // Atomic singleton write: upsert on the DB-enforced unique `singleton` key so
    // two concurrent first-saves converge to exactly ONE document. On a lost race
    // the loser's create hits Prisma's unique-constraint error P2002; the catch
    // below re-reads the winner and returns it with 200. `singleton` is set by its
    // schema default on create and left untouched on update.
    const saved = await prisma.webexSettings.upsert({
      where: { singleton: WEBEX_SETTINGS_SINGLETON },
      create: values,
      update: updateValues,
    });

    res.json(serializeWebexSettings(saved));
  } catch (error) {
    // Convergence on a lost first-save race: a concurrent creator won the unique
    // `singleton` key and this request's create hit P2002. The one document already
    // exists, so re-read it and return it with 200 — through the SAME masked
    // serializer, so the stored `botTokenEnc` is NEVER exposed — instead of a
    // spurious 500. A null re-read or a re-read that itself fails falls through to
    // the 500, and any NON-P2002 error keeps the existing 500 behavior.
    if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002') {
      try {
        const reread = await prisma.webexSettings.findUnique({
          where: { singleton: WEBEX_SETTINGS_SINGLETON },
        });
        if (reread) {
          return res.json(serializeWebexSettings(reread));
        }
      } catch (rereadError) {
        console.error('Error re-reading webex settings after concurrent create (P2002):', rereadError);
      }
    }
    // A non-Zod failure (DB write, encrypt) is a server error — never a 400.
    console.error('Error saving webex settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /test: send a short DM with the SAVED settings. Delivery is best-effort, so
// this ALWAYS responds 200; the structured WebexTestResult's `ok` field carries the
// outcome and an `ok: false` result includes a FIXED reason CATEGORY the admin UI
// translates. CRITICAL: the reason is one of a closed set of enum codes and NEVER
// contains any config- or error-derived text, so no token can leak here (the full
// error stays in the server log). See utils/webex.ts sendTestWebexMessage().
router.post('/test', requireRole(Role.ADMIN), async (req, res) => {
  const parsed = webexTestSendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { to } = parsed.data;

  try {
    const result = await sendTestWebexMessage(to);
    res.json(result);
  } catch (error) {
    console.error('Error sending test webex message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
