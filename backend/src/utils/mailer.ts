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

import nodemailer from 'nodemailer';
import { getEffectiveMailConfig } from '../config/mail';

// Conservative SMTP timeouts (ms). A dead/blackholed relay fails fast instead of
// holding a socket open. Applied to connect, greeting, and idle socket.
const SMTP_TIMEOUT_MS = 10_000;

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(options: SendMailOptions): Promise<boolean> {
  const toDisplay = Array.isArray(options.to) ? options.to.join(', ') : options.to;

  let cfg;
  try {
    cfg = await getEffectiveMailConfig();
  } catch (err) {
    // Database unreachable (or any settings-read failure): stay best-effort.
    console.error(`[MAIL] settings read failed to=${toDisplay} subject=${options.subject}:`, err);
    return false;
  }

  if (!cfg.effectiveEnabled) {
    // Disabled or half-configured (no host): never open a socket. Dev story.
    console.log(`[MAIL disabled] to=${toDisplay} subject=${options.subject}`);
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
      subject: options.subject,
      text: options.text,
      ...(options.html ? { html: options.html } : {}),
    });
    return true;
  } catch (err) {
    // Best-effort: swallow everything so the caller's request never fails.
    console.error(`[MAIL] send failed to=${toDisplay} subject=${options.subject}:`, err);
    return false;
  }
}
