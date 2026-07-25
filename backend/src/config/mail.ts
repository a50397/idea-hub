// Mail (outbound SMTP) configuration.
//
// Mirrors config/sso.ts: every value is read lazily from process.env at call
// time (never cached at module load) so that tests can set MAIL_* / SMTP_*
// variables before a send, and so the deployment can be reconfigured without
// code changes.
//
// Mail is BEST-EFFORT and OFF by default. `enabled` reflects the raw
// MAIL_ENABLED flag; `effectiveEnabled` additionally requires SMTP_HOST, so a
// half-configured deployment (flag on, no host) degrades to the disabled,
// log-only behavior instead of opening sockets to nowhere. The boot guard in
// index.ts turns that same half-configured state into a hard failure in
// production. validateMailConfig() is a pure status function (no process.exit)
// so it stays unit-testable and the caller decides fail-fast vs. warn.

const DEFAULT_SMTP_PORT = 587;
const DEFAULT_MAIL_FROM = 'IdeaHub <no-reply@ideahub.local>';

export function isMailEnabled(): boolean {
  return process.env.MAIL_ENABLED === 'true';
}

export interface MailConfig {
  /** Raw MAIL_ENABLED === 'true'. */
  enabled: boolean;
  /** enabled AND an SMTP_HOST is set — what the mailer actually keys off. */
  effectiveEnabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export function getMailConfig(): MailConfig {
  const enabled = isMailEnabled();
  const host = process.env.SMTP_HOST || '';
  const parsedPort = Number.parseInt(process.env.SMTP_PORT ?? '', 10);
  return {
    enabled,
    effectiveEnabled: enabled && host.length > 0,
    host,
    port: Number.isNaN(parsedPort) ? DEFAULT_SMTP_PORT : parsedPort,
    // Implicit TLS (SMTPS, usually :465). false => STARTTLS on the plain port.
    secure: process.env.SMTP_SECURE === 'true',
    // Auth is optional: company relays are frequently IP-allowlisted. The mailer
    // only attaches an auth object when a user is present (see utils/mailer.ts).
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || DEFAULT_MAIL_FROM,
  };
}

export interface MailConfigStatus {
  /** true when the configuration is coherent (which includes mail being off). */
  ok: boolean;
  /** Set only for a fatal misconfiguration: enabled but no SMTP_HOST. */
  fatal?: string;
  /** Non-fatal advisories worth logging on boot. */
  warnings: string[];
}

/**
 * Pure boot-time validation (no side effects, no process.exit) so it can be
 * unit-tested and so the caller decides fail-fast vs. warn per environment.
 *
 * - Disabled                -> always ok (nothing to validate; the default).
 * - Enabled, no SMTP_HOST   -> fatal-shaped: index.ts exits outside development
 *                              and warns + degrades to disabled in development.
 * - Enabled, host present   -> ok, plus soft advisories (e.g. user without pass).
 */
export function validateMailConfig(): MailConfigStatus {
  const cfg = getMailConfig();
  const warnings: string[] = [];

  if (!cfg.enabled) {
    return { ok: true, warnings };
  }

  if (!cfg.host) {
    return {
      ok: false,
      fatal: 'MAIL_ENABLED=true but SMTP_HOST is not set.',
      warnings,
    };
  }

  if (cfg.user && !cfg.pass) {
    warnings.push(
      'SMTP_USER is set but SMTP_PASS is empty; the relay may reject authentication.'
    );
  }

  return { ok: true, warnings };
}
