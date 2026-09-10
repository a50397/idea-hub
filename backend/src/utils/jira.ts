// Jira Cloud REST client — the OUTBOUND half of the Jira execution channel.
//
// Structural sibling of utils/webex.ts and it keeps the exact same discipline, for
// the same reasons: every call is best-effort and NEVER throws (a Jira outage can
// never fail a user request nor break a poll tick), every failure collapses to ONE
// of a CLOSED set of JiraFailureReason codes (never upstream text), and the API
// token is used as a credential ONLY — it is never logged, never echoed and never
// part of any returned value.
//
// Jira-specific hardening on top of the Webex baseline (all of it security review
// findings F1/F4/F5/F9 — do not relax any of these without re-reviewing):
//   - `redirect: 'manual'` on EVERY request. The API base is admin-controlled (the
//     stored site origin) or derived from it (the api.atlassian.com gateway route),
//     so an honored 3xx would replay the Basic credential to an attacker-chosen
//     origin. A 3xx is treated as a plain failure (F1).
//   - `AbortSignal.timeout(10s)` on every request and an explicit Content-Length
//     ceiling, so a hung or gigantic remote body cannot pin memory or a tick (F4).
//   - DEFENSIVE, field-by-field parsing (the parseWebexRooms pattern): remote JSON
//     is never spread into a Prisma `data` object and every ingested string goes
//     through sanitizeRemoteString() first (F4/F5).
//   - Issue ids are validated `/^\d+$/` BOTH when ingested and again before they are
//     joined into a JQL `id in (...)` clause, which is what makes JQL injection
//     structurally impossible (nothing else from the remote side reaches a query).
//
// Auth is HTTP Basic with the Jira account email as the username and the API token
// as the password (Jira Cloud's documented scheme for REST v3).

import {
  getEffectiveJiraConfig,
  isValidJiraCloudId,
  type EffectiveJiraConfig,
} from '../config/jira';

// Conservative request timeout (ms) — identical to the Webex client. A dead or
// blackholed endpoint fails fast via an AbortSignal instead of holding a request
// handler or a poll tick open.
const JIRA_TIMEOUT_MS = 10_000;

// Hard ceiling on a remote response body (bytes) as ADVERTISED by Content-Length.
// Every response this client reads is small (one issue, <=50 search rows, <=50
// projects), so a body an order of magnitude larger is by definition not something
// we should buffer. NOTE (accepted residual): a chunked response carries no
// Content-Length and therefore cannot be pre-checked — the 10s abort bounds it.
const JIRA_MAX_RESPONSE_BYTES = 1_048_576;

// Locale asked of Jira on every credentialed request. Jira resolves a request's
// language as: the account's own preference -> the Accept-Language header -> the
// SITE default. Our tech account is an Atlassian SERVICE ACCOUNT, which has no
// profile UI and therefore no preference, so without this header every mirrored
// status/resolution name arrives in whatever language the Jira site happens to
// default to (observed 2026-09-10: Simplified Chinese, "正在进行" for In Progress).
// That is not merely cosmetic — cancelResolutions matches CLOSING STATUS NAMES,
// so a localized "Won't Do" silently stops registering as a cancel and wedges the
// idea (the team-managed-project bug all over again). Pinning en-US makes the
// mirror language-stable regardless of the site setting, and matches the English
// DEFAULT_CANCEL_RESOLUTIONS. The canonical IdeaStatus never depended on this —
// it comes from statusCategory.key, which is an untranslated enum.
const JIRA_ACCEPT_LANGUAGE = 'en-US';

// Max issue ids per search request. Jira's /search/jql caps maxResults near 100;
// 50 keeps each JQL clause short and each response small (F4).
export const JIRA_SEARCH_CHUNK_SIZE = 50;

// Pages followed per chunk before giving up. With <=50 ids per chunk and
// maxResults=50 a single page always suffices; the loop exists only because the API
// contract allows a short page, and the cap keeps a pathological nextPageToken loop
// from spinning forever.
const JIRA_SEARCH_PAGE_CAP = 5;

// Project-picker paging: 50 per page, at most 20 pages (1000 projects). A larger
// installation is TRUNCATED to the first 1000 — an accepted limit for an admin
// picker that always also offers manual key entry (the Webex rooms precedent).
const JIRA_PROJECT_PAGE_SIZE = 50;
const JIRA_PROJECT_PAGE_CAP = 20;

// Ingest cap for every remote string (issue key, status name, assignee display
// name, resolution name). Comfortably above any real Jira value.
const REMOTE_STRING_MAX = 255;

// Jira's summary field limit.
const JIRA_SUMMARY_MAX = 255;

// Backoff (seconds) the poller applies when Jira answers 5xx and offers no
// Retry-After. Also the clamp bounds for a Retry-After we DO get, so a hostile or
// broken header can neither disable polling for days nor make it hot-loop.
const SERVER_ERROR_BACKOFF_SECONDS = 60;
const MIN_RETRY_AFTER_SECONDS = 1;
const MAX_RETRY_AFTER_SECONDS = 3600;

/**
 * Fixed failure categories the admin UI and the poller log can translate. NEVER
 * free-form text.
 *
 * Jira-specific buckets: `invalid_credentials` (401/403 — the email+token Basic
 * pair was rejected), `project_not_found` (the target project key does not exist or
 * is not visible to the tech user), `invalid_request` (a 400 that is not about the
 * project — e.g. a rejected field), and `rate_limited` (429). The transport buckets
 * MIRROR the mail and Webex channels so all three test buttons are equally
 * actionable: `host_not_found` (DNS), `connection_refused`, `tls_error` and
 * `timeout`, with `connection_failed` as the generic transport fallback.
 * `config_error` = disabled / not configured (no network call); `unknown` =
 * anything else, INCLUDING a refused redirect and an unparseable 2xx body.
 *
 * SECURITY (F9): a returned value is ALWAYS one of these fixed codes. The HTTP
 * status, the low-level cause code and a 400 body only SELECT which code to return
 * — no upstream `errorMessages`, no status text, no URL and no credential is ever
 * placed into the reason or into any API response.
 */
export type JiraFailureReason =
  | 'invalid_credentials'
  | 'project_not_found'
  | 'invalid_request'
  | 'rate_limited'
  | 'timeout'
  | 'host_not_found'
  | 'connection_refused'
  | 'tls_error'
  | 'connection_failed'
  | 'config_error'
  | 'unknown';

/** Structured failure shared by every call. `retryAfterSeconds` is advisory. */
export interface JiraFailure {
  ok: false;
  reason: JiraFailureReason;
  /**
   * How long the caller should wait before trying again — set from a 429's
   * `Retry-After` (clamped) and to a fixed default for a 5xx, so the poller can
   * back off on BOTH without ever seeing an upstream string. Absent otherwise.
   */
  retryAfterSeconds?: number;
}

// ---------------------------------------------------------------------------
// Remote-string ingest boundary (F5)
// ---------------------------------------------------------------------------

/**
 * Normalize a value coming FROM Jira before it is stored, rendered or logged.
 *
 * Strips C0 control characters and DEL (which would otherwise forge '[JIRA]' log
 * lines or corrupt a CSV/terminal), turns TAB and every line separator into a space,
 * DROPS the invisible formatting characters (bidi overrides/isolates, zero-width
 * marks), collapses any whitespace run into a single space (these are all
 * single-line labels), trims, and caps the length. Returns null for a non-string, or
 * when nothing survives — callers then store null rather than an empty string, so
 * "no assignee" and "assignee named ''" cannot be confused.
 *
 * EVERY remote string (issue key, status name, assignee display name, resolution
 * name) passes through here before it reaches the database or a response.
 */
export function sanitizeRemoteString(value: unknown, max: number = REMOTE_STRING_MAX): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    // TAB and the line separators become a SPACE first, so collapsing never glues
    // two words together — "In\tReview" is one label, not "InReview". The remaining
    // C0 controls + DEL are then dropped outright (they would forge log lines /
    // corrupt a CSV cell).
    .replace(/[\t\r\n\u0085\u2028\u2029]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    // INVISIBLE formatting characters, DROPPED rather than spaced (they sit inside a
    // word, so a space would corrupt the label). A bidi override or isolate
    // (U+202A-U+202E, U+2066-U+2069) makes a rendered status/assignee read in a
    // different order than it is stored — the classic spoofing trick against a label
    // a human is meant to trust — and a zero-width character (U+200B-U+200D, U+FEFF)
    // hides inside one, so two values that render identically are not equal (which
    // also silently defeats the poller's "did this field change?" comparisons).
    // Neither can be part of a legitimate Jira status, resolution or display name.
    .replace(/[\u200b-\u200d\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    // Any surviving whitespace run (NBSP et al., which none of the passes above
    // touch) collapses to one space.
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, max);
}

/**
 * A numeric Jira issue id, the poll key. Jira ids are numeric strings and are
 * STABLE across project moves (unlike the human key), which is why the poller keys
 * off them. Validating the format at every boundary is also what keeps the JQL
 * `id in (...)` clause injection-proof.
 */
export function isValidJiraIssueId(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value);
}

// Jira project/issue keys are uppercase alphanumeric with a numeric suffix
// ("ABC-123"). Used to gate the browse URL we hand to a browser.
const JIRA_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

// ---------------------------------------------------------------------------
// Browse URL (F7)
// ---------------------------------------------------------------------------

/**
 * Build the browser-facing `{base}/browse/{KEY}` URL for an issue, or null when it
 * cannot be built SAFELY.
 *
 * EXACT PROTOCOL RULE (security review F7 — pinned by a unit test covering all
 * three cases). This URL is rendered as a link in the SPA, so a `javascript:`-style
 * base would be stored XSS:
 *   - base came from the DATABASE  -> `https:` only.
 *   - base came from JIRA_API_BASE_URL (the test/proxy override) -> `http:` or
 *     `https:` (the e2e mock Jira is plain loopback HTTP).
 *   - any other scheme, an unparseable base, or a key that is not a Jira key ->
 *     null, and the caller OMITS the field entirely rather than emitting something
 *     partial the FE might still render.
 * The DB-side rule is belt-and-braces: routes/jira-settings.ts already refuses to
 * store a non-https base URL.
 */
export function buildJiraBrowseUrl(cfg: EffectiveJiraConfig, issueKey: string | null | undefined): string | null {
  if (typeof issueKey !== 'string' || !JIRA_KEY_PATTERN.test(issueKey)) return null;
  if (typeof cfg.baseUrl !== 'string' || cfg.baseUrl.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(cfg.baseUrl);
  } catch {
    return null; // not a parseable absolute URL -> no link at all
  }

  const allowed = cfg.baseUrlFromEnv ? ['https:', 'http:'] : ['https:'];
  if (!allowed.includes(parsed.protocol)) return null;

  // The key already matched JIRA_KEY_PATTERN (no slashes, no scheme, no controls);
  // encode anyway so the path segment is unambiguous.
  return `${cfg.baseUrl}/browse/${encodeURIComponent(issueKey)}`;
}

// ---------------------------------------------------------------------------
// ADF (Atlassian Document Format)
// ---------------------------------------------------------------------------

export interface AdfTextNode {
  type: 'text';
  text: string;
}
export interface AdfParagraph {
  type: 'paragraph';
  content?: AdfTextNode[];
}
export interface AdfDoc {
  type: 'doc';
  version: 1;
  content: AdfParagraph[];
}

/**
 * Convert plain text into a minimal ADF document.
 *
 * Jira REST v3 REQUIRES the issue description to be ADF — a plain string is
 * rejected with a 400. Each non-empty line becomes its own paragraph with a single
 * text node; blank lines are dropped because an EMPTY text node ("text": "") is
 * itself invalid ADF. Text with nothing left produces one empty paragraph (valid,
 * and never an empty text node).
 */
export function plainTextToAdf(text: string): AdfDoc {
  const lines = (typeof text === 'string' ? text : '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { type: 'doc', version: 1, content: [{ type: 'paragraph' }] };
  }

  return {
    type: 'doc',
    version: 1,
    content: lines.map((line) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: line }],
    })),
  };
}

// ---------------------------------------------------------------------------
// Low-level request plumbing
// ---------------------------------------------------------------------------

// HTTP Basic credential built from the Jira account email + API token. Kept in one
// place so no call site can accidentally build (or log) it differently.
function basicAuthHeader(cfg: EffectiveJiraConfig): string {
  return `Basic ${Buffer.from(`${cfg.email}:${cfg.token}`, 'utf8').toString('base64')}`;
}

interface JiraRequestInit {
  method: 'GET' | 'POST';
  /** Already-serialized JSON body (POST only). */
  body?: string;
}

/**
 * Issue one AUTHENTICATED Jira REST request. Every credentialed call in this
 * module funnels through here so the auth header, the ~10s abort,
 * `redirect: 'manual'` (F1) and the JSON/locale headers are IDENTICAL everywhere. The ONE
 * deliberate bypass is resolveJiraCloudId: it targets a public endpoint and must
 * NOT send the Authorization header, so it issues its own bare fetch carrying the
 * same transport discipline — keep it the only one. The AbortSignal.timeout timer
 * is unref'd by Node, so a pending call never keeps the process alive.
 */
function jiraFetch(cfg: EffectiveJiraConfig, path: string, init: JiraRequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: basicAuthHeader(cfg),
    Accept: 'application/json',
    // See JIRA_ACCEPT_LANGUAGE: without it the service account inherits the SITE
    // default language and the mirrored status names come back translated.
    'Accept-Language': JIRA_ACCEPT_LANGUAGE,
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  // `apiBaseUrl`, NOT `baseUrl`: with a resolved cloud id this is the
  // api.atlassian.com/ex/jira/{cloudId} gateway (the only base a SCOPED API token
  // authenticates against); otherwise the two are the same origin. Browse URLs
  // keep using `baseUrl` — see buildJiraBrowseUrl.
  return fetch(`${cfg.apiBaseUrl}${path}`, {
    method: init.method,
    headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
    // SECURITY (F1): never follow a redirect — the admin-controlled base URL must
    // not be able to bounce the Basic credential to another origin.
    redirect: 'manual',
    signal: AbortSignal.timeout(JIRA_TIMEOUT_MS),
  });
}

/**
 * A 3xx reached us only because redirects are refused, so it is a FAILURE (never a
 * hop to follow). Written as an explicit predicate because `res.ok` is false for a
 * 3xx too and we want the refusal to be visible (and logged) as its own case.
 */
function isRefusedRedirect(res: Response): boolean {
  return res.status >= 300 && res.status < 400;
}

/**
 * True when the response ADVERTISES a body larger than we are ever willing to
 * buffer (F4). Checked BEFORE any .json()/.text() so an oversized body is never
 * read. Tolerant of a header-less response object (missing/!get -> not too large).
 */
function isBodyTooLarge(res: Response): boolean {
  const raw = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : null;
  if (raw === null || raw === undefined) return false;
  const length = Number(raw);
  return Number.isFinite(length) && length > JIRA_MAX_RESPONSE_BYTES;
}

/** Parse a JSON body, returning null (never throwing) when it is not JSON. */
async function readJson(res: Response): Promise<unknown | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Read a body as text purely to CATEGORIZE it; the text never reaches a caller. */
async function readTextForCategorization(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

// Node/undici certificate-validation codes that indicate a TLS failure but do NOT
// carry the ERR_TLS / ERR_SSL prefix. Same set as the Webex client so all three
// channels bucket certificate problems identically.
const TLS_CERT_ERROR_CODES = new Set<string>([
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

// undici wraps a low-level connect/DNS/TLS failure in TypeError('fetch failed')
// whose `.cause` carries the real code. That code is logged (so an admin can tell
// DNS apart from a refused connect) and SELECTS a fixed bucket — it never lands in
// a returned reason, and the token is never logged.
function fetchCauseCode(err: unknown): string | undefined {
  const cause = (err as { cause?: unknown } | null)?.cause;
  const code = (cause as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

function transportReasonFromCauseCode(code: string | undefined): JiraFailureReason | undefined {
  if (code === undefined) return undefined;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EDNS') return 'host_not_found';
  if (code === 'ECONNREFUSED') return 'connection_refused';
  if (code === 'ETIMEDOUT') return 'timeout';
  if (code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL') || TLS_CERT_ERROR_CODES.has(code)) {
    return 'tls_error';
  }
  return undefined;
}

/**
 * Map a THROWN fetch error to one fixed category, derived only from the error's
 * kind and the low-level undici cause code (never from message text). Identical in
 * structure to mapWebexThrownFailure.
 */
function mapThrownFailure(err: unknown): JiraFailureReason {
  const name = typeof (err as { name?: unknown } | null)?.name === 'string'
    ? (err as { name: string }).name
    : '';
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';

  const bucketed = transportReasonFromCauseCode(fetchCauseCode(err));
  if (bucketed !== undefined) return bucketed;

  if (err instanceof TypeError) return 'connection_failed';
  return 'unknown';
}

/**
 * Advisory wait derived from a response. A 429's `Retry-After` (integer seconds
 * form) is honored but CLAMPED to [1s, 1h] so neither a hostile nor a broken header
 * can hot-loop the poller or silence it for days; a 5xx gets a fixed default so the
 * poller backs off on server trouble too (F13). Returns undefined otherwise.
 */
function retryAfterFromResponse(res: Response): number | undefined {
  if (res.status === 429) {
    const raw = res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(Math.max(Math.trunc(parsed), MIN_RETRY_AFTER_SECONDS), MAX_RETRY_AFTER_SECONDS);
    }
    return SERVER_ERROR_BACKOFF_SECONDS;
  }
  if (res.status >= 500) return SERVER_ERROR_BACKOFF_SECONDS;
  return undefined;
}

/**
 * Map a non-OK response with NO project context (search, single issue, /myself,
 * project search) to one fixed category. Synchronous: the body is never read, so it
 * can neither influence the category nor reach a caller.
 */
function mapGenericFailure(res: Response): JiraFailureReason {
  if (isRefusedRedirect(res)) return 'unknown';
  if (res.status === 401 || res.status === 403) return 'invalid_credentials';
  if (res.status === 429) return 'rate_limited';
  if (res.status === 400) return 'invalid_request';
  return 'unknown';
}

/** Build a failure result, attaching the advisory backoff when the status carries one. */
function failure(res: Response, reason: JiraFailureReason): JiraFailure {
  const retryAfterSeconds = retryAfterFromResponse(res);
  return retryAfterSeconds === undefined ? { ok: false, reason } : { ok: false, reason, retryAfterSeconds };
}

/**
 * Warn (once per operation) when a stored token will not decrypt — the channel then
 * reads as not configured, which is otherwise indistinguishable from "no token".
 * Never logs the token or the ciphertext.
 */
function warnIfUndecryptableToken(cfg: EffectiveJiraConfig): void {
  if (cfg.enabled && cfg.hasToken && !cfg.tokenDecryptable) {
    console.warn(
      '[JIRA] a stored API token could not be decrypted (check MAIL_SETTINGS_KEY); Jira is treated as not configured.'
    );
  }
}

// ---------------------------------------------------------------------------
// Issue snapshot (the mirrored fields)
// ---------------------------------------------------------------------------

/** The status categories Jira defines. Anything else is normalized to null. */
export type JiraStatusCategoryKey = 'new' | 'indeterminate' | 'done';
const STATUS_CATEGORY_KEYS: readonly string[] = ['new', 'indeterminate', 'done'];

/**
 * The mirrored subset of a Jira issue. EXACTLY the fields the idea shows or the
 * lifecycle mapping needs — nothing else from the remote payload is carried, and
 * every string has already been through sanitizeRemoteString().
 */
export interface JiraIssueSnapshot {
  /** Human issue key ("ABC-123"); refreshed on every poll (a key can change). */
  key: string | null;
  /** Raw status NAME as configured in the Jira workflow ("In Review"). */
  statusName: string | null;
  /** status.statusCategory.key — drives the canonical IdeaStatus. */
  categoryKey: JiraStatusCategoryKey | null;
  /** assignee.displayName, or null when unassigned. */
  assignee: string | null;
  /** resolution.name, or null while unresolved. */
  resolution: string | null;
}

/**
 * Defensive, field-by-field projection of one remote issue object (the
 * parseWebexRooms pattern, F4). Every field is read through an optional chain,
 * type-checked and sanitized; a missing or wrongly-typed field becomes null instead
 * of throwing. The remote object is NEVER spread anywhere near a Prisma `data`.
 */
function parseIssueSnapshot(raw: unknown): JiraIssueSnapshot {
  const fields = (raw as { fields?: unknown } | null)?.fields;
  const status = (fields as { status?: unknown } | null)?.status;
  const categoryRaw = (status as { statusCategory?: unknown } | null)?.statusCategory;
  const categoryKeyRaw = (categoryRaw as { key?: unknown } | null)?.key;
  const categoryKey =
    typeof categoryKeyRaw === 'string' && STATUS_CATEGORY_KEYS.includes(categoryKeyRaw.toLowerCase())
      ? (categoryKeyRaw.toLowerCase() as JiraStatusCategoryKey)
      : null;

  return {
    key: sanitizeRemoteString((raw as { key?: unknown } | null)?.key),
    statusName: sanitizeRemoteString((status as { name?: unknown } | null)?.name),
    categoryKey,
    assignee: sanitizeRemoteString(
      ((fields as { assignee?: unknown } | null)?.assignee as { displayName?: unknown } | null)?.displayName
    ),
    resolution: sanitizeRemoteString(
      ((fields as { resolution?: unknown } | null)?.resolution as { name?: unknown } | null)?.name
    ),
  };
}

// ---------------------------------------------------------------------------
// createJiraIssue — POST /rest/api/3/issue
// ---------------------------------------------------------------------------

export interface CreateJiraIssueInput {
  projectKey: string;
  /** Issue summary (the idea title). Newline-free and capped here defensively. */
  summary: string;
  /** Plain text; converted to ADF (REST v3 rejects a plain-string description). */
  description: string;
}

export type CreateJiraIssueResult =
  | { ok: true; issueId: string; issueKey: string; browseUrl: string | null }
  | JiraFailure;

/**
 * Map a non-OK issue-create response. This is the ONE endpoint with project
 * context, so it has its own mapper: 404 means the project key does not resolve for
 * the tech user, and Jira answers an unknown project with a 400 whose body names
 * the project field — categorized (never surfaced) as project_not_found so the
 * admin gets an actionable message. Any other 400 is invalid_request.
 *
 * The 400 keyword scan is the ONLY place this client reads an ERROR body, so it
 * carries the same Content-Length ceiling as every 2xx read (F4): an oversized 400
 * is NOT read at all and falls back to the generic invalid_request. Losing the
 * project/issuetype refinement on a pathological body is the cheap side of that
 * trade — the alternative is buffering an attacker-sized body to pick a nicer
 * error code.
 */
async function mapCreateIssueFailure(res: Response): Promise<JiraFailureReason> {
  if (isRefusedRedirect(res)) return 'unknown';
  if (res.status === 401 || res.status === 403) return 'invalid_credentials';
  if (res.status === 404) return 'project_not_found';
  if (res.status === 429) return 'rate_limited';
  if (res.status === 400) {
    if (isBodyTooLarge(res)) {
      console.error('[JIRA] create issue error body exceeded the size limit; not read');
      return 'invalid_request';
    }
    const body = await readTextForCategorization(res);
    if (/project|issuetype|issue type/i.test(body)) return 'project_not_found';
    return 'invalid_request';
  }
  return 'unknown';
}

/**
 * Create a Jira issue. NEVER throws.
 *
 *   - not effectively enabled            -> { ok: false, config_error } (no call)
 *   - created (2xx, id+key parse)        -> { ok: true, issueId, issueKey, browseUrl }
 *   - 2xx whose body does not parse      -> { ok: false, unknown }
 *   - non-OK / thrown                    -> { ok: false, <mapped> }
 *
 * NO LABELS are sent: Jira rejects labels containing whitespace, and idea tags are
 * free text — tags stay in-app. The summary is flattened to one line and capped at
 * Jira's 255-char limit; the description is converted to ADF.
 */
export async function createJiraIssue(
  cfg: EffectiveJiraConfig,
  input: CreateJiraIssueInput
): Promise<CreateJiraIssueResult> {
  if (!cfg.effectiveEnabled) {
    warnIfUndecryptableToken(cfg);
    console.log('[JIRA disabled] create issue');
    return { ok: false, reason: 'config_error' };
  }

  const summary = input.summary.replace(/\s*(?:\r\n|\r|\n)\s*/g, ' ').trim().slice(0, JIRA_SUMMARY_MAX);
  const body = JSON.stringify({
    fields: {
      project: { key: input.projectKey },
      summary,
      description: plainTextToAdf(input.description),
      issuetype: { name: cfg.issueTypeName },
    },
  });

  let res: Response;
  try {
    res = await jiraFetch(cfg, '/rest/api/3/issue', { method: 'POST', body });
  } catch (err) {
    const code = fetchCauseCode(err);
    console.error(`[JIRA] create issue failed project=${input.projectKey}${code ? ` cause=${code}` : ''}:`, err);
    return { ok: false, reason: mapThrownFailure(err) };
  }

  if (!res.ok) {
    const reason = await mapCreateIssueFailure(res);
    console.error(`[JIRA] create issue failed project=${input.projectKey} status=${res.status}`);
    return failure(res, reason);
  }

  if (isBodyTooLarge(res)) {
    console.error('[JIRA] create issue response exceeded the size limit');
    return { ok: false, reason: 'unknown' };
  }

  const payload = await readJson(res);
  const issueId = (payload as { id?: unknown } | null)?.id;
  const issueKey = sanitizeRemoteString((payload as { key?: unknown } | null)?.key);
  // The id is the poll key AND the only remote value that ever reaches a JQL
  // clause, so a non-numeric id is rejected outright rather than stored.
  if (!isValidJiraIssueId(issueId) || issueKey === null) {
    console.error('[JIRA] create issue returned an unusable body (missing/invalid id or key)');
    return { ok: false, reason: 'unknown' };
  }

  return { ok: true, issueId, issueKey, browseUrl: buildJiraBrowseUrl(cfg, issueKey) };
}

// ---------------------------------------------------------------------------
// searchJiraIssuesByIds — POST /rest/api/3/search/jql
// ---------------------------------------------------------------------------

export type JiraSearchResult =
  | { ok: true; issues: Map<string, JiraIssueSnapshot> }
  | JiraFailure;

/**
 * Fetch the mirrored fields for a set of issue ids. NEVER throws.
 *
 * The legacy `/rest/api/{2,3}/search` endpoint is GONE (410); this uses the
 * replacement `POST /rest/api/3/search/jql`, whose contract shapes this code:
 *   - `fields` MUST be given explicitly (the default projection is `id` only),
 *   - there is no `total`; paging is a `nextPageToken` cursor,
 *   - `maxResults` is effectively capped near 100.
 * Ids are chunked (JIRA_SEARCH_CHUNK_SIZE) and each chunk becomes a bounded
 * `id in (...)` JQL clause. Every id is re-validated `/^\d+$/` immediately before
 * that join, which is what makes the clause injection-proof.
 *
 * An issue that is absent from the result is NOT proof of deletion (Jira search is
 * eventually consistent) — the caller confirms with getJiraIssue() and only a 404
 * counts (and even then only on two consecutive ticks, F11).
 *
 * A failing chunk aborts the whole call (partial results would look like deletions
 * to the caller).
 */
export async function searchJiraIssuesByIds(
  cfg: EffectiveJiraConfig,
  ids: string[]
): Promise<JiraSearchResult> {
  if (!cfg.effectiveEnabled) {
    warnIfUndecryptableToken(cfg);
    console.log('[JIRA disabled] search issues');
    return { ok: false, reason: 'config_error' };
  }

  // Validate + dedupe before chunking: a malformed id must never reach the JQL.
  const validIds = Array.from(new Set(ids.filter(isValidJiraIssueId)));
  const issues = new Map<string, JiraIssueSnapshot>();
  if (validIds.length === 0) return { ok: true, issues };

  for (let offset = 0; offset < validIds.length; offset += JIRA_SEARCH_CHUNK_SIZE) {
    const chunk = validIds.slice(offset, offset + JIRA_SEARCH_CHUNK_SIZE);
    // Re-validated above; the join is over numeric strings only.
    const jql = `id in (${chunk.join(',')})`;

    let nextPageToken: string | undefined;
    for (let page = 0; page < JIRA_SEARCH_PAGE_CAP; page++) {
      const body = JSON.stringify({
        jql,
        maxResults: JIRA_SEARCH_CHUNK_SIZE,
        // MANDATORY: without this the response carries ids only.
        fields: ['status', 'assignee', 'resolution'],
        ...(nextPageToken !== undefined ? { nextPageToken } : {}),
      });

      let res: Response;
      try {
        res = await jiraFetch(cfg, '/rest/api/3/search/jql', { method: 'POST', body });
      } catch (err) {
        const code = fetchCauseCode(err);
        console.error(`[JIRA] issue search failed${code ? ` cause=${code}` : ''}:`, err);
        return { ok: false, reason: mapThrownFailure(err) };
      }

      if (!res.ok) {
        console.error(`[JIRA] issue search failed status=${res.status}`);
        return failure(res, mapGenericFailure(res));
      }

      if (isBodyTooLarge(res)) {
        console.error('[JIRA] issue search response exceeded the size limit');
        return { ok: false, reason: 'unknown' };
      }

      const payload = await readJson(res);
      const rawIssues = (payload as { issues?: unknown } | null)?.issues;
      if (!Array.isArray(rawIssues)) {
        console.error('[JIRA] issue search returned an unparseable body');
        return { ok: false, reason: 'unknown' };
      }

      for (const raw of rawIssues) {
        const id = (raw as { id?: unknown } | null)?.id;
        // Only ids we ASKED for are accepted, so a rogue response cannot inject a
        // snapshot for an idea that was not part of this batch.
        if (!isValidJiraIssueId(id) || !chunk.includes(id)) continue;
        issues.set(id, parseIssueSnapshot(raw));
      }

      const token = (payload as { nextPageToken?: unknown } | null)?.nextPageToken;
      if (typeof token !== 'string' || token.length === 0) break;
      nextPageToken = token;
    }
  }

  return { ok: true, issues };
}

// ---------------------------------------------------------------------------
// getJiraIssue — GET /rest/api/3/issue/{id}
// ---------------------------------------------------------------------------

export type JiraIssueResult =
  | { ok: true; found: true; issue: JiraIssueSnapshot }
  | { ok: true; found: false }
  | JiraFailure;

/**
 * Read ONE issue by id — the DELETION-CONFIRM primitive. NEVER throws.
 *
 * Jira search is eventually consistent, so a search miss alone must never be read
 * as deletion. Only an HTTP 404 here counts as "gone", and the caller still
 * requires TWO consecutive confirmed ticks before acting (F11) because a 404 also
 * appears when the tech user merely loses permission.
 */
export async function getJiraIssue(cfg: EffectiveJiraConfig, issueId: string): Promise<JiraIssueResult> {
  if (!cfg.effectiveEnabled) {
    warnIfUndecryptableToken(cfg);
    console.log('[JIRA disabled] get issue');
    return { ok: false, reason: 'config_error' };
  }
  if (!isValidJiraIssueId(issueId)) {
    // A non-numeric id can only come from a corrupted document; never build a URL
    // out of it (it would be path injection on our own base URL).
    console.error('[JIRA] get issue called with a non-numeric id');
    return { ok: false, reason: 'invalid_request' };
  }

  let res: Response;
  try {
    res = await jiraFetch(cfg, `/rest/api/3/issue/${issueId}?fields=status,assignee,resolution`, {
      method: 'GET',
    });
  } catch (err) {
    const code = fetchCauseCode(err);
    console.error(`[JIRA] get issue failed id=${issueId}${code ? ` cause=${code}` : ''}:`, err);
    return { ok: false, reason: mapThrownFailure(err) };
  }

  // The ONLY status that means "gone". Everything else (including 403 permission
  // loss and any 5xx) stays a failure, so the caller skips the tick instead of
  // cancelling an idea.
  if (res.status === 404) return { ok: true, found: false };

  if (!res.ok) {
    console.error(`[JIRA] get issue failed id=${issueId} status=${res.status}`);
    return failure(res, mapGenericFailure(res));
  }

  if (isBodyTooLarge(res)) {
    console.error('[JIRA] get issue response exceeded the size limit');
    return { ok: false, reason: 'unknown' };
  }

  const payload = await readJson(res);
  if (payload === null || typeof payload !== 'object') {
    console.error('[JIRA] get issue returned an unparseable body');
    return { ok: false, reason: 'unknown' };
  }

  return { ok: true, found: true, issue: parseIssueSnapshot(payload) };
}

// ---------------------------------------------------------------------------
// Cloud-id resolution (scoped-API-token support)
// ---------------------------------------------------------------------------

/**
 * Resolve the Atlassian cloud id of a Jira Cloud site from its PUBLIC
 * `{site}/_edge/tenant_info` endpoint ({"cloudId": "<uuid>"}). Returns the id, or
 * null on ANY failure (the caller stores null and the client falls back to calling
 * the site origin directly, which keeps classic unscoped tokens working).
 *
 * Called ONLY by routes/jira-settings.ts (save + test-button self-heal) with the
 * save-time-validated https site URL — never from a dispatch or a poll tick, so a
 * hot path never grows a second network round-trip.
 *
 * SECURITY:
 *   - The endpoint is unauthenticated and this request carries NO Authorization
 *     header — the credential is never sent to a URL that resolution itself is
 *     about to influence.
 *   - Same transport discipline as every other call in this module: 10s abort,
 *     `redirect: 'manual'` (a 3xx is a failure, never followed), Content-Length
 *     ceiling before the body is read.
 *   - The returned id passes isValidJiraCloudId before it is accepted, so nothing
 *     the remote side sends can smuggle a path or origin into the gateway URL join.
 */
export async function resolveJiraCloudId(siteBaseUrl: string): Promise<string | null> {
  const base = siteBaseUrl.trim().replace(/\/+$/, '');
  if (base.length === 0) return null;

  let res: Response;
  try {
    res = await fetch(`${base}/_edge/tenant_info`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(JIRA_TIMEOUT_MS),
    });
  } catch (err) {
    const code = fetchCauseCode(err);
    console.error(`[JIRA] cloud-id resolution failed${code ? ` cause=${code}` : ''}:`, err);
    return null;
  }

  if (!res.ok) {
    console.error(`[JIRA] cloud-id resolution failed status=${res.status}`);
    return null;
  }

  if (isBodyTooLarge(res)) {
    console.error('[JIRA] cloud-id resolution response exceeded the size limit');
    return null;
  }

  const payload = await readJson(res);
  const cloudId = (payload as { cloudId?: unknown } | null)?.cloudId;
  if (!isValidJiraCloudId(cloudId)) {
    console.error('[JIRA] cloud-id resolution returned an unusable body');
    return null;
  }
  return cloudId;
}

// ---------------------------------------------------------------------------
// ADMIN diagnostics: connection test + project picker
// ---------------------------------------------------------------------------

export type JiraTestResult = { ok: true } | { ok: false; reason: JiraFailureReason };

/**
 * Diagnostic call used ONLY by POST /api/jira-settings/test: `GET /rest/api/3/myself`
 * with the SAVED settings. The cheapest call that proves base URL + credential.
 * Mirrors sendTestWebexMessage: never throws, always a fixed reason category, the
 * full error stays in the server log (never the token, never the body).
 */
export async function testJiraConnection(): Promise<JiraTestResult> {
  let cfg: EffectiveJiraConfig;
  try {
    cfg = await getEffectiveJiraConfig();
  } catch (err) {
    console.error('[JIRA] test settings read failed:', err);
    return { ok: false, reason: 'config_error' };
  }

  if (!cfg.effectiveEnabled) {
    warnIfUndecryptableToken(cfg);
    console.log('[JIRA disabled] connection test');
    return { ok: false, reason: 'config_error' };
  }

  let res: Response;
  try {
    res = await jiraFetch(cfg, '/rest/api/3/myself', { method: 'GET' });
  } catch (err) {
    const code = fetchCauseCode(err);
    console.error(`[JIRA] connection test failed${code ? ` cause=${code}` : ''}:`, err);
    return { ok: false, reason: mapThrownFailure(err) };
  }

  if (!res.ok) {
    console.error(`[JIRA] connection test failed status=${res.status}`);
    return { ok: false, reason: mapGenericFailure(res) };
  }
  return { ok: true };
}

/** The minimal project shape the admin picker needs. */
export interface JiraProject {
  key: string;
  name: string;
}

export type JiraProjectsResult =
  | { ok: true; projects: JiraProject[] }
  | { ok: false; reason: JiraFailureReason };

/**
 * List the projects the tech user can see (`GET /rest/api/3/project/search`), for
 * the admin's default-project picker and the per-department override picker. NEVER
 * throws; the FE always also offers manual key entry (the Webex rooms precedent).
 *
 * Paginated with startAt/maxResults until `isLast`, capped at
 * JIRA_PROJECT_PAGE_CAP pages — a bigger installation is silently TRUNCATED to the
 * first 1000 projects (logged), which is acceptable for a picker with manual entry.
 * A project whose key is missing/not a string is skipped; a nameless project falls
 * back to its key as the label.
 */
export async function listJiraProjects(): Promise<JiraProjectsResult> {
  let cfg: EffectiveJiraConfig;
  try {
    cfg = await getEffectiveJiraConfig();
  } catch (err) {
    console.error('[JIRA] projects settings read failed:', err);
    return { ok: false, reason: 'config_error' };
  }

  if (!cfg.effectiveEnabled) {
    warnIfUndecryptableToken(cfg);
    console.log('[JIRA disabled] projects');
    return { ok: false, reason: 'config_error' };
  }

  const projects: JiraProject[] = [];
  let startAt = 0;

  for (let page = 0; page < JIRA_PROJECT_PAGE_CAP; page++) {
    let res: Response;
    try {
      res = await jiraFetch(
        cfg,
        `/rest/api/3/project/search?startAt=${startAt}&maxResults=${JIRA_PROJECT_PAGE_SIZE}`,
        { method: 'GET' }
      );
    } catch (err) {
      const code = fetchCauseCode(err);
      console.error(`[JIRA] projects fetch failed${code ? ` cause=${code}` : ''}:`, err);
      return { ok: false, reason: mapThrownFailure(err) };
    }

    if (!res.ok) {
      console.error(`[JIRA] projects fetch failed status=${res.status}`);
      return { ok: false, reason: mapGenericFailure(res) };
    }

    if (isBodyTooLarge(res)) {
      console.error('[JIRA] projects response exceeded the size limit');
      return { ok: false, reason: 'unknown' };
    }

    const payload = await readJson(res);
    const values = (payload as { values?: unknown } | null)?.values;
    // `values` missing / not an array is a PARSE failure, distinct from a genuine
    // empty listing (`values: []` -> an OK zero-project result).
    if (!Array.isArray(values)) {
      console.error('[JIRA] projects fetch returned an unparseable body');
      return { ok: false, reason: 'unknown' };
    }

    for (const item of values) {
      const key = sanitizeRemoteString((item as { key?: unknown } | null)?.key);
      if (key === null) continue;
      const name = sanitizeRemoteString((item as { name?: unknown } | null)?.name);
      projects.push({ key, name: name ?? key });
    }

    const isLast = (payload as { isLast?: unknown } | null)?.isLast;
    if (isLast !== false) break; // absent/true/anything-but-false -> stop
    startAt += JIRA_PROJECT_PAGE_SIZE;

    if (page === JIRA_PROJECT_PAGE_CAP - 1) {
      console.warn(
        `[JIRA] project listing truncated at ${projects.length} projects (page cap reached); manual key entry still available`
      );
    }
  }

  return { ok: true, projects };
}
