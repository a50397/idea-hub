// Best-effort outbound mail.
//
// sendMail() has a deliberately narrow contract: it NEVER throws and NEVER
// rejects, so callers can fire-and-forget (`void sendMail(...)`) from inside a
// request handler and a mail outage can never fail the user's request.
//
//   - Config now lives in the database (admin-managed MailSettings). sendMail
//     reads the effective config PER SEND (never cached), so an admin edit takes
//     effect on the next send with no restart.
//   - A DB read failure is swallowed: log via console.error and resolve false.
//   - Disabled (default) OR enabled-but-missing-host -> log the would-send line
//     and resolve true. This log-only mode IS the local dev story.
//   - Enabled + host -> build a FRESH transport per send (no caching) with
//     conservative timeouts so a dead relay cannot pile up sockets, send, and
//     resolve true. On ANY failure (createTransport throw or sendMail reject)
//     log via console.error and resolve false.
//
// A stored-but-undecryptable password (wrong/rotated MAIL_SETTINGS_KEY) is
// treated as no password and warned about ONCE per send attempt — the secret is
// never logged.

import { getSystemErrorName } from 'node:util';
import nodemailer from 'nodemailer';
import { getEffectiveMailConfig, type EffectiveMailConfig } from '../config/mail';

// Conservative SMTP timeouts (ms). A dead/blackholed relay fails fast instead of
// holding a socket open. Applied to connect, greeting, and idle socket.
const SMTP_TIMEOUT_MS = 10_000;

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

// Collapse CR/LF and any other control characters in a subject to a single space.
// Defense-in-depth at the mailer boundary: a newline in a user-controlled idea
// title must never (a) forge an extra SMTP header (belt-and-braces over
// nodemailer's own header encoding) nor (b) forge a '[MAIL ...]' log line (log
// injection). The class folds every C0 control (0x00-0x1F, incl. CR/LF/TAB/VT/FF)
// and DEL (0x7F); visible characters (hyphens, normal spaces) are preserved and
// the result is trimmed. Body text is deliberately NOT touched.
function sanitizeSubject(subject: string): string {
  return subject.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();
}

export async function sendMail(
  options: SendMailOptions,
  cfgOverride?: EffectiveMailConfig
): Promise<boolean> {
  const toDisplay = Array.isArray(options.to) ? options.to.join(', ') : options.to;
  // Sanitize once, up front, so the folded subject is what reaches BOTH every
  // '[MAIL ...]' log line below and nodemailer's transport.sendMail.
  const subject = sanitizeSubject(options.subject);

  let cfg: EffectiveMailConfig;
  if (cfgOverride !== undefined) {
    // The caller already read the effective config (e.g. to build the notification
    // template) and hands that SAME in-memory object through, so we do NOT read it a
    // second time. This is a pure pass-through of a config the caller already holds —
    // no new trust surface, no new secret exposure. Every guarantee below is identical
    // to the self-read path (never throws/rejects, log-only when disabled, fresh
    // transport per send, secret never logged, subject sanitized).
    cfg = cfgOverride;
  } else {
    try {
      cfg = await getEffectiveMailConfig();
    } catch (err) {
      // Database unreachable (or any settings-read failure): stay best-effort.
      console.error(`[MAIL] settings read failed to=${toDisplay} subject=${subject}:`, err);
      return false;
    }
  }

  if (!cfg.effectiveEnabled) {
    // Disabled or half-configured (no host): never open a socket. Dev story.
    console.log(`[MAIL disabled] to=${toDisplay} subject=${subject}`);
    return true;
  }

  // A stored password that will not decrypt (wrong/rotated key) is treated as no
  // password. Warn so the misconfiguration is visible; never log the secret.
  if (cfg.hasPassword && !cfg.passwordDecryptable) {
    console.warn(
      '[MAIL] a stored SMTP password could not be decrypted (check MAIL_SETTINGS_KEY); sending without stored credentials.'
    );
  }

  try {
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      // Auth only when a user is configured — IP-allowlisted relays take none.
      ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.pass } } : {}),
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    });

    await transport.sendMail({
      from: cfg.from,
      to: options.to,
      subject,
      text: options.text,
      ...(options.html ? { html: options.html } : {}),
    });
    return true;
  } catch (err) {
    // Best-effort: swallow everything so the caller's request never fails.
    console.error(`[MAIL] send failed to=${toDisplay} subject=${subject}:`, err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// ADMIN diagnostic test-send (POST /api/mail-settings/test).
//
// sendMail() above keeps its opaque boolean, never-throw contract for the
// fire-and-forget notification path (its only addition is an OPTIONAL caller-
// supplied config override that changes nothing about its guarantees). The admin
// "Send test email" button, however, needs to EXPLAIN a failure, so this
// dedicated path mirrors sendMail's config-read + transport-build (a REAL send)
// but returns a STRUCTURED result instead of a boolean.
//
// SECURITY (the whole point of this path): the failure `reason` handed back to
// the client is ALWAYS one of the seven FIXED MailFailureReason codes below,
// derived ONLY from the error's `.code` / system errno — NEVER from
// err.message/.response/.command or any config value (host, port, username,
// from, password). The client receives a CATEGORY; the full error stays in the
// server log via console.error, exactly as sendMail logs it. This preserves the
// proven "password/secret never travels in any API response" guarantee.
// ---------------------------------------------------------------------------

/** Fixed failure categories the admin UI can translate. NEVER free-form text. */
export type MailFailureReason =
  | 'connection_refused'
  | 'auth_failed'
  | 'timeout'
  | 'host_not_found'
  | 'tls_error'
  | 'config_error'
  | 'unknown';

/** Structured outcome of a diagnostic test send. */
export type MailTestResult =
  | { status: 'sent' }
  | { status: 'disabled' }
  | { status: 'failed'; reason: MailFailureReason };

// Recover the underlying OS error name (e.g. 'ECONNREFUSED', 'ETIMEDOUT',
// 'ENOTFOUND') from a numeric errno, portably across platforms. nodemailer masks
// several connect-phase OS failures under a single 'ESOCKET' code (see
// smtp-connection: _onConnectionSocketError -> _onError(err, 'ESOCKET'), which
// _formatError then relabels), so the real cause survives ONLY on err.errno.
// Returns '' when there is no usable errno. Used for CATEGORIZATION only — the
// recovered name never reaches the client.
function systemErrorName(err: unknown): string {
  const errno = (err as { errno?: unknown } | null | undefined)?.errno;
  if (typeof errno === 'number') {
    try {
      return getSystemErrorName(errno);
    } catch {
      // errno was not a known system error code — fall through to ''.
      return '';
    }
  }
  return '';
}

// Map a thrown send error to ONE fixed reason CATEGORY. CRITICAL (security): the
// return value is always one of the seven MailFailureReason codes and is derived
// ONLY from the error's `.code` and (portable) system errno — never from any
// message/response text or config value. Categories mirror nodemailer 9's real
// error shapes (verified empirically), not just the documented codes:
//   EAUTH                                   -> auth_failed
//   ECONNREFUSED                            -> connection_refused
//   ETIMEDOUT (connect/greeting/socket)     -> timeout
//   EDNS / ENOTFOUND / EAI_AGAIN            -> host_not_found
//   ESOCKET                                 -> tls_error, UNLESS the system errno
//       reveals a masked connect failure (ECONNREFUSED/ETIMEDOUT/host lookup),
//       which nodemailer collapses into ESOCKET (e.g. a refused TCP connect).
//   ETLS / ERR_TLS* / ERR_SSL*              -> tls_error
//   anything else                           -> unknown
function mapMailFailure(err: unknown): MailFailureReason {
  const rawCode = (err as { code?: unknown } | null | undefined)?.code;
  const code = typeof rawCode === 'string' ? rawCode : '';
  const sysName = systemErrorName(err);

  switch (code) {
    case 'EAUTH':
      return 'auth_failed';
    case 'ECONNREFUSED':
      return 'connection_refused';
    case 'ETIMEDOUT':
      return 'timeout';
    case 'EDNS':
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'host_not_found';
    case 'ESOCKET':
      // nodemailer collapses connect-phase OS failures into ESOCKET; recover the
      // real cause from the system errno before defaulting to a TLS/socket error.
      if (sysName === 'ECONNREFUSED') return 'connection_refused';
      if (sysName === 'ETIMEDOUT') return 'timeout';
      if (sysName === 'ENOTFOUND' || sysName === 'EAI_AGAIN') return 'host_not_found';
      return 'tls_error';
    case 'ETLS':
      return 'tls_error';
  }

  // A raw Node TLS/SSL error code that escaped nodemailer's relabeling.
  if (code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL')) return 'tls_error';

  // Last resort: classify purely from the system errno when the code was unhelpful.
  if (sysName === 'ECONNREFUSED') return 'connection_refused';
  if (sysName === 'ETIMEDOUT') return 'timeout';
  if (sysName === 'ENOTFOUND' || sysName === 'EAI_AGAIN') return 'host_not_found';

  return 'unknown';
}

/**
 * Diagnostic send used ONLY by POST /api/mail-settings/test. Mirrors sendMail's
 * config-read + transport-build so the test exercises the SAME send path as a
 * real notification, but reports a structured MailTestResult the admin UI can
 * explain. Like sendMail it never throws.
 *
 *   - settings read throws        -> { status: 'failed', reason: 'config_error' }
 *   - disabled / half-configured  -> { status: 'disabled' } (NO socket opened;
 *     this is the fix for the old log-only "success" the test button reported)
 *   - send succeeds               -> { status: 'sent' }
 *   - send throws                 -> { status: 'failed', reason: <mapped> }
 *
 * The full error is logged server-side via console.error EXACTLY as sendMail
 * does; the client only ever receives the fixed reason category.
 */
export async function sendTestMail(to: string): Promise<MailTestResult> {
  const subject = '[IdeaHub] Test email';

  let cfg;
  try {
    cfg = await getEffectiveMailConfig();
  } catch (err) {
    // Database unreachable (or any settings-read failure): report a fixed category.
    console.error(`[MAIL] test settings read failed to=${to} subject=${subject}:`, err);
    return { status: 'failed', reason: 'config_error' };
  }

  if (!cfg.effectiveEnabled) {
    // Disabled or half-configured (no host): never open a socket.
    console.log(`[MAIL disabled] test to=${to} subject=${subject}`);
    return { status: 'disabled' };
  }

  // A stored password that will not decrypt (wrong/rotated key) is treated as no
  // password. Warn so the misconfiguration is visible; never log the secret.
  if (cfg.hasPassword && !cfg.passwordDecryptable) {
    console.warn(
      '[MAIL] a stored SMTP password could not be decrypted (check MAIL_SETTINGS_KEY); sending without stored credentials.'
    );
  }

  try {
    // Mirror sendMail's transport build exactly (same host/port/secure/auth/
    // timeouts) so the test is a faithful dry run of a real notification send.
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      // Auth only when a user is configured — IP-allowlisted relays take none.
      ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.pass } } : {}),
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    });

    await transport.sendMail({
      from: cfg.from,
      to,
      subject,
      text: 'This is a test email from IdeaHub to verify your outbound mail settings.',
    });
    return { status: 'sent' };
  } catch (err) {
    // Full detail stays in the SERVER log (unchanged from sendMail); the CLIENT
    // only ever receives the fixed category from mapMailFailure(err).
    console.error(`[MAIL] test send failed to=${to} subject=${subject}:`, err);
    return { status: 'failed', reason: mapMailFailure(err) };
  }
}
