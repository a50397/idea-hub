// Mail (outbound SMTP) configuration — now ADMIN-UI-managed and DB-backed.
//
// The single MailSettings document (see prisma/schema.prisma) is the source of
// truth: an admin edits it via /api/mail-settings (routes/mail-settings.ts). This
// module reads it and derives the effective config the mailer keys off. There are
// NO MAIL_* / SMTP_* environment reads anymore — the only env this feature touches
// is MAIL_SETTINGS_KEY, consumed solely by utils/secretbox.ts for password
// encryption.
//
// Read path: findFirst() ?? in-code defaults, so an absent document means "mail
// disabled with defaults" (no boot seed is required). Mail stays BEST-EFFORT and
// OFF by default: `effectiveEnabled` requires both `enabled` AND a non-empty host,
// so a half-configured deployment (enabled with no host) degrades to disabled,
// log-only behavior instead of opening sockets to nowhere. Save-time validation in
// the PUT route rejects the enabled-but-hostless combination up front.

import prisma from '../lib/prisma';
import { decrypt } from '../utils/secretbox';

// Notification-wording language. 'en' is the built-in default (English); 'sk'
// selects the Slovak wording. Stored on the settings document and validated to the
// en|sk enum by the PUT route; normalized defensively here on read.
export type MailLang = 'en' | 'sk';
const SUPPORTED_MAIL_LANGS: readonly MailLang[] = ['en', 'sk'];
const DEFAULT_MAIL_LANG: MailLang = 'en';

const DEFAULT_MAIL_FROM = 'IdeaHub <no-reply@ideahub.local>';
const DEFAULT_SMTP_PORT = 587;

function normalizeLang(value: string | null | undefined): MailLang {
  const raw = (value ?? '').trim();
  return (SUPPORTED_MAIL_LANGS as readonly string[]).includes(raw)
    ? (raw as MailLang)
    : DEFAULT_MAIL_LANG;
}

// The in-code defaults used when no MailSettings document exists yet. Kept in one
// place so the GET route (masked view of an absent doc) and the effective-config
// derivation agree. NOTE: `passwordEnc` is intentionally part of the raw defaults
// but is NEVER surfaced by the API.
export interface MailSettingsRecord {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  passwordEnc: string;
  from: string;
  language: string;
  subjectTemplate: string;
}

export const MAIL_SETTINGS_DEFAULTS: MailSettingsRecord = {
  enabled: false,
  host: '',
  port: DEFAULT_SMTP_PORT,
  secure: false,
  username: '',
  passwordEnc: '',
  from: DEFAULT_MAIL_FROM,
  language: DEFAULT_MAIL_LANG,
  subjectTemplate: '',
};

// The effective config the mailer + templates consume. `pass` is the DECRYPTED
// password ('' when none or undecryptable). `hasPassword` reflects whether a
// ciphertext is stored at all; `passwordDecryptable` is false when a stored
// ciphertext failed to decrypt (wrong/rotated MAIL_SETTINGS_KEY) — the mailer uses
// that to warn without ever logging the secret.
export interface EffectiveMailConfig {
  enabled: boolean;
  effectiveEnabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  language: MailLang;
  /** Empty string means "use the built-in subject wording". */
  subjectTemplate: string;
  hasPassword: boolean;
  passwordDecryptable: boolean;
}

/**
 * Read the singleton MailSettings document, or the in-code defaults when none
 * exists yet. May reject if the database is unreachable — the mailer awaits this
 * inside its own try/catch and degrades to a logged failure (never throws).
 */
export async function getMailSettingsRecord(): Promise<MailSettingsRecord> {
  const doc = await prisma.mailSettings.findFirst();
  if (!doc) return { ...MAIL_SETTINGS_DEFAULTS };
  return {
    enabled: doc.enabled,
    host: doc.host,
    port: doc.port,
    secure: doc.secure,
    username: doc.username,
    passwordEnc: doc.passwordEnc,
    from: doc.from,
    language: doc.language,
    subjectTemplate: doc.subjectTemplate,
  };
}

/**
 * Derive the effective mail configuration from the stored settings, decrypting the
 * password (null-tolerant). `effectiveEnabled` is `enabled && host` so a
 * half-configured record stays log-only.
 */
export async function getEffectiveMailConfig(): Promise<EffectiveMailConfig> {
  const s = await getMailSettingsRecord();

  const host = (s.host ?? '').trim();
  const hasPassword = (s.passwordEnc ?? '').length > 0;

  let pass = '';
  let passwordDecryptable = false;
  if (hasPassword) {
    const decrypted = decrypt(s.passwordEnc);
    if (decrypted !== null) {
      pass = decrypted;
      passwordDecryptable = true;
    }
    // decrypted === null -> undecryptable; treated as no password (mailer warns).
  }

  const subjectTemplate = (s.subjectTemplate ?? '').trim().length > 0 ? s.subjectTemplate : '';

  return {
    enabled: s.enabled,
    effectiveEnabled: s.enabled && host.length > 0,
    host,
    port: s.port,
    secure: s.secure,
    user: s.username ?? '',
    pass,
    from: s.from && s.from.length > 0 ? s.from : DEFAULT_MAIL_FROM,
    language: normalizeLang(s.language),
    subjectTemplate,
    hasPassword,
    passwordDecryptable,
  };
}
