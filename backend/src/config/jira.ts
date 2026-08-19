// Jira Cloud integration configuration — ADMIN-UI-managed and DB-backed, exactly
// like config/mail.ts and the config half of utils/webex.ts.
//
// The single JiraSettings document (see prisma/schema.prisma) is the source of
// truth: an admin edits it via /api/jira-settings (routes/jira-settings.ts). This
// module reads it and derives the effective config the Jira client (utils/jira.ts),
// the dispatch endpoint and the poller (utils/jira-sync.ts) key off. It is read PER
// OPERATION (never cached), so an admin edit takes effect on the next dispatch/tick.
//
// Read path: findUnique on the DB-enforced unique `singleton` key ?? in-code
// defaults, so an absent document means "Jira disabled with defaults" (no boot
// seed). Jira stays OFF by default: `effectiveEnabled` requires `enabled` AND a
// base URL AND an account email AND a usable DECRYPTED token — the email+token pair
// IS the Basic credential — so a half-configured deployment never opens a socket.
//
// The only environment variables this feature touches are JIRA_API_BASE_URL, the
// test-only poll accelerator JIRA_POLL_INTERVAL_MS (utils/jira-sync.ts), and
// MAIL_SETTINGS_KEY (consumed solely by utils/secretbox.ts for token encryption).
// JIRA_API_BASE_URL is the WEBEX_API_BASE_URL precedent: a test/proxy override that
// takes precedence over the stored base URL for BOTH outbound calls and the browse
// URL handed to the browser. It is deliberately allowed to be http:// (the e2e mock
// Jira runs on plain loopback HTTP) while a DB-stored base URL is https-only — see
// `baseUrlFromEnv` below and utils/jira.ts buildJiraBrowseUrl().
//
// TEST-ONLY, ENFORCED (not by convention): the override is read ONLY when
// NODE_ENV === 'test'. Outside a test run it is a credential-retarget primitive that
// bypasses everything the save-time validation buys — it would send the stored
// email+token to an arbitrary, possibly plain-http origin without going through the
// F1 base-URL rules or the F2 credential-binding rule, from a plain environment
// variable. Every tier that legitimately uses it runs with NODE_ENV=test: the unit
// tier (`npm test`), the integration tier (setup/env.ts) and the e2e backend
// (e2e/support/config.ts).

import prisma from '../lib/prisma';
import { decrypt } from '../utils/secretbox';

// The value of the DB-enforced unique `singleton` discriminator on JiraSettings
// (see prisma/schema.prisma). SINGLE SOURCE OF TRUTH for the key: every singleton
// read here + in routes/jira-settings.ts and the PUT upsert write key off this
// exact constant, so reads and writes address the same one document.
export const JIRA_SETTINGS_SINGLETON = 'singleton';

// Jira's own default issue type in a fresh project.
const DEFAULT_ISSUE_TYPE_NAME = 'Task';

// Poll period bounds (minutes). Also enforced by the PUT validation schema; applied
// again here so a hand-edited document can never produce a hot loop or an interval
// that silently never fires.
export const MIN_POLL_INTERVAL_MINUTES = 1;
export const MAX_POLL_INTERVAL_MINUTES = 1440; // 24h
const DEFAULT_POLL_INTERVAL_MINUTES = 5;

// Jira resolution names that mean "not actually done" — an issue reaching a
// done-category status with one of these returns the idea to APPROVED instead of
// completing it. Matches the schema default; kept here so an absent settings
// document yields the same behavior as a freshly saved one.
export const DEFAULT_CANCEL_RESOLUTIONS = "Won't Do,Cancelled,Duplicate";

/**
 * Trailing-slash-free origin form used for every URL join (`${base}/rest/api/3/...`,
 * `${base}/browse/KEY`). Applied to both the stored and the env-override value so a
 * pasted "https://acme.atlassian.net/" can never produce a double slash.
 */
function stripTrailingSlashes(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/**
 * The JIRA_API_BASE_URL override ('' when unset/blank — or whenever this is not a
 * test run, which is the enforcement described in the module header: outside
 * NODE_ENV=test the variable is IGNORED and the stored base URL always wins).
 */
function envBaseUrlOverride(): string {
  if (process.env.NODE_ENV !== 'test') return '';
  return stripTrailingSlashes(process.env.JIRA_API_BASE_URL ?? '');
}

/**
 * Whether the JIRA_API_BASE_URL override is in effect. The cloud-id machinery keys
 * off this: with the override active every call goes to the override origin (the
 * e2e mock), so resolving or routing through the Atlassian gateway would be
 * meaningless — routes/jira-settings.ts skips resolution entirely.
 */
export function jiraBaseUrlEnvOverrideActive(): boolean {
  return envBaseUrlOverride().length > 0;
}

// Fixed Atlassian API gateway prefix. SCOPED API tokens only authenticate against
// `https://api.atlassian.com/ex/jira/{cloudId}/rest/...` — site-origin calls reject
// them — while classic unscoped tokens work on both. When a cloud id is stored,
// ALL outbound REST calls therefore go through the gateway (one code path for both
// token kinds); the site base URL remains the browse-link origin.
export const JIRA_GATEWAY_BASE = 'https://api.atlassian.com/ex/jira';

// Atlassian cloud ids are UUIDs in practice; accept a conservative superset. The
// guard is SECURITY-relevant, not cosmetic: the stored value is joined into the
// gateway URL, so a hand-edited document must never be able to smuggle a path
// (slash), a query, or another origin into that join.
const JIRA_CLOUD_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
export function isValidJiraCloudId(value: unknown): value is string {
  return typeof value === 'string' && JIRA_CLOUD_ID_PATTERN.test(value);
}

// Set on the first malformed-cloudId warning so it fires once per process, not once
// per config read (see getEffectiveJiraConfig).
let warnedMalformedCloudId = false;

// The in-code defaults used when no JiraSettings document exists yet — the read
// path returns these so an absent document simply means "Jira disabled with
// defaults" (no boot seed). `apiTokenEnc` is null (the column is nullable) and is
// NEVER surfaced by the API.
export interface JiraSettingsRecord {
  enabled: boolean;
  baseUrl: string;
  // Atlassian cloud id of the site at `baseUrl`, or null while unresolved — see
  // prisma/schema.prisma. Written by routes/jira-settings.ts (save + test), read
  // here to pick the outbound API base.
  cloudId: string | null;
  email: string;
  apiTokenEnc: string | null;
  defaultProjectKey: string;
  issueTypeName: string;
  pollIntervalMinutes: number;
  cancelResolutions: string;
  // --- background-sync health (STATUS, not configuration) --------------------
  // Written ONLY by the poller (utils/jira-sync.ts), and only when the outcome
  // CHANGES; read by routes/jira-settings.ts (the admin's settings page) and
  // routes/options.ts (the admin banner flag). Never accepted as API input.
  //   lastSyncOk     null = nothing recorded yet | true = last run completed
  //                  | false = last run failed
  //   lastSyncReason the closed JiraFailureReason code of that failure, or null
  //   lastSyncAt     when the CURRENT state was entered ("in this state since"),
  //                  NOT the time of the last attempt
  // Typed as `string | null` rather than the JiraFailureReason union because this
  // is the raw stored column: a document hand-edited (or written by an older
  // build) could hold anything, and consumers already resolve unknown codes
  // through their "unknown" fallback.
  lastSyncOk: boolean | null;
  lastSyncReason: string | null;
  lastSyncAt: Date | null;
}

export const JIRA_SETTINGS_DEFAULTS: JiraSettingsRecord = {
  enabled: false,
  baseUrl: '',
  cloudId: null,
  email: '',
  apiTokenEnc: null,
  defaultProjectKey: '',
  issueTypeName: DEFAULT_ISSUE_TYPE_NAME,
  pollIntervalMinutes: DEFAULT_POLL_INTERVAL_MINUTES,
  cancelResolutions: DEFAULT_CANCEL_RESOLUTIONS,
  // No document == no sync has ever been recorded (and none ever will be while
  // the integration stays unconfigured).
  lastSyncOk: null,
  lastSyncReason: null,
  lastSyncAt: null,
};

/**
 * The effective config the Jira client, the dispatch endpoint and the poller
 * consume. `token` is the DECRYPTED API token ('' when none or undecryptable);
 * `hasToken` reflects whether a ciphertext is stored at all and `tokenDecryptable`
 * is false when a stored ciphertext failed to decrypt (wrong/rotated
 * MAIL_SETTINGS_KEY) — mirrors EffectiveWebexConfig.
 *
 * `baseUrlFromEnv` records WHERE `baseUrl` came from, which is a SECURITY-relevant
 * distinction and not cosmetic: a DB-stored base URL is validated https-only at
 * save time, while the JIRA_API_BASE_URL override may legitimately be plain http
 * (the e2e mock). The browse URL handed to the browser therefore accepts http ONLY
 * when the base came from the env override — see utils/jira.ts buildJiraBrowseUrl().
 */
export interface EffectiveJiraConfig {
  enabled: boolean;
  effectiveEnabled: boolean;
  /** Origin without a trailing slash. Env override wins over the stored value. */
  baseUrl: string;
  /**
   * Base for OUTBOUND REST calls (utils/jira.ts jiraFetch): the env override when
   * active, else the api.atlassian.com/ex/jira/{cloudId} gateway when a cloud id is
   * stored (required for scoped API tokens), else `baseUrl` itself. Browse URLs
   * NEVER use this — they are built from `baseUrl` (buildJiraBrowseUrl).
   */
  apiBaseUrl: string;
  /** True when `baseUrl` came from JIRA_API_BASE_URL rather than the database. */
  baseUrlFromEnv: boolean;
  email: string;
  /** Decrypted API token; '' when absent or undecryptable. NEVER logged. */
  token: string;
  defaultProjectKey: string;
  issueTypeName: string;
  /** Clamped to [MIN_POLL_INTERVAL_MINUTES, MAX_POLL_INTERVAL_MINUTES]. */
  pollIntervalMinutes: number;
  /** Trimmed, lowercased, non-empty resolution names (comparison form). */
  cancelResolutions: string[];
  hasToken: boolean;
  tokenDecryptable: boolean;
}

/**
 * Read the singleton JiraSettings document by its unique `singleton` key, or the
 * in-code defaults when none exists yet. The unique index guarantees at most one
 * document, so findUnique is deterministic (and matches the PUT upsert's key). May
 * reject if the database is unreachable — every caller awaits this inside its own
 * try/catch and degrades to a logged failure (never throws at them).
 */
export async function getJiraSettingsRecord(): Promise<JiraSettingsRecord> {
  const doc = await prisma.jiraSettings.findUnique({ where: { singleton: JIRA_SETTINGS_SINGLETON } });
  if (!doc) return { ...JIRA_SETTINGS_DEFAULTS };
  return {
    enabled: doc.enabled,
    baseUrl: doc.baseUrl,
    // `?? null`: a document predating the field has no such key (see the lastSync*
    // note below) — normalize to the one "unresolved" value.
    cloudId: doc.cloudId ?? null,
    email: doc.email,
    apiTokenEnc: doc.apiTokenEnc,
    defaultProjectKey: doc.defaultProjectKey,
    issueTypeName: doc.issueTypeName,
    pollIntervalMinutes: doc.pollIntervalMinutes,
    cancelResolutions: doc.cancelResolutions,
    // `?? null` because a document written before these fields existed simply has
    // no such key: Prisma types them as nullable, but a hand-rolled/legacy read can
    // still surface undefined — normalize both to null here so every consumer sees
    // exactly one "nothing recorded" value.
    lastSyncOk: doc.lastSyncOk ?? null,
    lastSyncReason: doc.lastSyncReason ?? null,
    lastSyncAt: doc.lastSyncAt ?? null,
  };
}

/**
 * Parse the stored comma-separated cancel-resolution list into its COMPARISON form:
 * trimmed, lowercased, blanks dropped. The poller lowercases the remote resolution
 * name the same way, so matching is case-insensitive without re-normalizing per
 * comparison.
 */
export function parseCancelResolutions(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * Derive the effective Jira configuration from the stored settings, decrypting the
 * API token (null-tolerant). `effectiveEnabled` is
 * `enabled && baseUrl && email && token` — the DECRYPTED token, since email+token
 * form the Basic credential — so a disabled, half-configured or
 * undecryptable-token record never opens a socket and the dispatch endpoint
 * refuses up front with a 400 instead of failing at the network.
 */
export async function getEffectiveJiraConfig(): Promise<EffectiveJiraConfig> {
  const s = await getJiraSettingsRecord();

  const hasToken = (s.apiTokenEnc ?? '').length > 0;

  let token = '';
  let tokenDecryptable = false;
  if (hasToken) {
    const decrypted = decrypt(s.apiTokenEnc as string);
    if (decrypted !== null) {
      token = decrypted;
      tokenDecryptable = true;
    }
    // decrypted === null -> undecryptable; treated as no token (callers warn).
  }

  // The env override takes precedence over the stored value for BOTH outbound calls
  // and the browse URL (the e2e mock Jira story), and is remembered as such so the
  // browse-URL builder can apply the right scheme rule.
  const override = envBaseUrlOverride();
  const baseUrlFromEnv = override.length > 0;
  const baseUrl = baseUrlFromEnv ? override : stripTrailingSlashes(s.baseUrl ?? '');

  // Outbound API base: gateway routing applies only to a real (DB-configured) site.
  // A stored cloud id that fails the shape guard is treated as unresolved — falling
  // back to the site origin keeps unscoped tokens working and, more importantly,
  // keeps a hand-edited value out of the URL join (see isValidJiraCloudId).
  const cloudId = isValidJiraCloudId(s.cloudId) ? s.cloudId : null;
  if (s.cloudId !== null && cloudId === null && !warnedMalformedCloudId) {
    // Once per process: this read path runs per OPERATION — including the
    // browse-URL attach on every ideas list/detail request — so a hand-edited
    // document must not turn every page load into a log line.
    warnedMalformedCloudId = true;
    console.warn('[JIRA] stored cloudId has an unexpected shape; calling the site base URL directly');
  }
  const apiBaseUrl =
    baseUrlFromEnv || cloudId === null ? baseUrl : `${JIRA_GATEWAY_BASE}/${cloudId}`;

  const email = (s.email ?? '').trim();

  const rawInterval = Number(s.pollIntervalMinutes);
  const pollIntervalMinutes = Number.isFinite(rawInterval)
    ? Math.min(Math.max(Math.trunc(rawInterval), MIN_POLL_INTERVAL_MINUTES), MAX_POLL_INTERVAL_MINUTES)
    : DEFAULT_POLL_INTERVAL_MINUTES;

  return {
    enabled: s.enabled,
    effectiveEnabled:
      s.enabled && baseUrl.length > 0 && email.length > 0 && token.length > 0,
    baseUrl,
    apiBaseUrl,
    baseUrlFromEnv,
    email,
    token,
    defaultProjectKey: (s.defaultProjectKey ?? '').trim(),
    issueTypeName:
      (s.issueTypeName ?? '').trim().length > 0 ? s.issueTypeName.trim() : DEFAULT_ISSUE_TYPE_NAME,
    pollIntervalMinutes,
    cancelResolutions: parseCancelResolutions(s.cancelResolutions),
    hasToken,
    tokenDecryptable,
  };
}
