// Webex notification channel: config read + best-effort sender.
//
// A second, INDEPENDENT notification channel alongside mail. A Webex send targets
// EITHER a person (a 1:1 bot direct message, `toPersonEmail`) OR a room/space
// (`roomId`) via the same `POST {base}/v1/messages` endpoint — never both. Like the
// mailer this module keeps a narrow, never-throw contract so callers can
// fire-and-forget from inside a request handler and a Webex outage can never fail
// the user's request nor affect the mail channel. `listWebexRooms` (a GET on
// `/v1/rooms`) lets an admin pick a room the bot belongs to; it shares the same
// never-throw + fixed-reason discipline and NEVER returns the token.
//
//   - Config lives in the database (admin-managed WebexSettings singleton, the
//     same shape/semantics as MailSettings). getEffectiveWebexConfig reads it PER
//     SEND (never cached), so an admin edit takes effect on the next send.
//   - The stored bot token is AES-256-GCM ciphertext (utils/secretbox.ts) keyed
//     by the SAME MAIL_SETTINGS_KEY as the SMTP password — no new key env var.
//   - `effectiveEnabled` requires `enabled` AND a non-empty DECRYPTED token: the
//     token IS the Bearer credential, so a disabled/half-configured/undecryptable
//     deployment degrades to log-only (no network call), never opening a socket
//     to nowhere. Mirrors the mailer's log-only dev story.
//   - sendWebexMessage never throws/rejects; it resolves a boolean. The token is
//     NEVER written to a log line (only the recipient and the HTTP status are).

import prisma from '../lib/prisma';
import { decrypt } from '../utils/secretbox';

// The value of the DB-enforced unique `singleton` discriminator on WebexSettings
// (see prisma/schema.prisma). SINGLE SOURCE OF TRUTH for the key: every singleton
// read here + in routes/webex-settings.ts and the PUT upsert write key off this
// exact constant, so reads and writes address the same one document.
export const WEBEX_SETTINGS_SINGLETON = 'singleton';

// Notification-wording language. Unlike mail (which defaults to 'en'), Webex
// defaults to 'sk' per the settings schema; both are validated to the en|sk enum
// by the PUT route and normalized defensively here on read.
export type WebexLang = 'en' | 'sk';
const SUPPORTED_WEBEX_LANGS: readonly WebexLang[] = ['en', 'sk'];
const DEFAULT_WEBEX_LANG: WebexLang = 'sk';

// Default Webex API origin. Overridable via WEBEX_API_BASE_URL (used by tests and
// any future proxy); a trailing slash is trimmed so the '/v1/messages' join is
// always well-formed.
const DEFAULT_WEBEX_API_BASE_URL = 'https://webexapis.com';

// Conservative request timeout (ms). A dead/blackholed endpoint fails fast via an
// AbortSignal instead of holding the fire-and-forget task open.
const WEBEX_TIMEOUT_MS = 10_000;

const TEST_MESSAGE_MARKDOWN =
  'This is a test message from IdeaHub to verify your Webex notification settings.';

function normalizeWebexLang(value: string | null | undefined): WebexLang {
  const raw = (value ?? '').trim();
  return (SUPPORTED_WEBEX_LANGS as readonly string[]).includes(raw)
    ? (raw as WebexLang)
    : DEFAULT_WEBEX_LANG;
}

function webexApiBaseUrl(): string {
  const raw = (process.env.WEBEX_API_BASE_URL ?? '').trim();
  return (raw.length > 0 ? raw : DEFAULT_WEBEX_API_BASE_URL).replace(/\/+$/, '');
}

// The in-code defaults used when no WebexSettings document exists yet — the read
// path returns these so an absent document simply means "Webex disabled with
// defaults" (no boot seed). `botTokenEnc` is null (the column is nullable) and is
// NEVER surfaced by the API.
export interface WebexSettingsRecord {
  enabled: boolean;
  botTokenEnc: string | null;
  language: string;
}

export const WEBEX_SETTINGS_DEFAULTS: WebexSettingsRecord = {
  enabled: false,
  botTokenEnc: null,
  language: DEFAULT_WEBEX_LANG,
};

// The effective config the sender + templates consume. `token` is the DECRYPTED
// bot token ('' when none or undecryptable). `hasToken` reflects whether a
// ciphertext is stored at all; `tokenDecryptable` is false when a stored
// ciphertext failed to decrypt (wrong/rotated MAIL_SETTINGS_KEY).
export interface EffectiveWebexConfig {
  enabled: boolean;
  effectiveEnabled: boolean;
  token: string;
  language: WebexLang;
  hasToken: boolean;
  tokenDecryptable: boolean;
}

/**
 * Read the singleton WebexSettings document by its unique `singleton` key, or the
 * in-code defaults when none exists yet. The unique index guarantees at most one
 * document, so findUnique is deterministic (and matches the PUT upsert's key). May
 * reject if the database is unreachable — the sender awaits this inside its own
 * try/catch and degrades to a logged failure (never throws).
 */
export async function getWebexSettingsRecord(): Promise<WebexSettingsRecord> {
  const doc = await prisma.webexSettings.findUnique({ where: { singleton: WEBEX_SETTINGS_SINGLETON } });
  if (!doc) return { ...WEBEX_SETTINGS_DEFAULTS };
  return {
    enabled: doc.enabled,
    botTokenEnc: doc.botTokenEnc,
    language: doc.language,
  };
}

/**
 * Derive the effective Webex configuration from the stored settings, decrypting
 * the bot token (null-tolerant). `effectiveEnabled` is `enabled && token` (the
 * DECRYPTED token, since it is the Bearer credential) so a disabled, tokenless, or
 * undecryptable-token record stays log-only.
 */
export async function getEffectiveWebexConfig(): Promise<EffectiveWebexConfig> {
  const s = await getWebexSettingsRecord();

  const hasToken = (s.botTokenEnc ?? '').length > 0;

  let token = '';
  let tokenDecryptable = false;
  if (hasToken) {
    const decrypted = decrypt(s.botTokenEnc as string);
    if (decrypted !== null) {
      token = decrypted;
      tokenDecryptable = true;
    }
    // decrypted === null -> undecryptable; treated as no token (sender warns).
  }

  return {
    enabled: s.enabled,
    effectiveEnabled: s.enabled && token.length > 0,
    token,
    language: normalizeWebexLang(s.language),
    hasToken,
    tokenDecryptable,
  };
}

/**
 * Options for a single Webex send. A DISCRIMINATED UNION so EXACTLY ONE target is
 * present at the type level: a Webex message targets a person (1:1 bot DM,
 * `toPersonEmail`) OR a room/space (`roomId`) — never both and never neither — via the
 * same POST /v1/messages endpoint. `markdown` (the Webex-markdown body) is required in
 * both arms. The recipient email is resolved by Webex to the 1:1 bot DM person; room
 * ids are OPAQUE strings and the bot must be a member of the room. (sendWebexMessage
 * still defends at runtime against a caller that reaches past these types with neither
 * field — see its no-target guard.)
 */
export type SendWebexOptions =
  | { toPersonEmail: string; markdown: string }
  | { roomId: string; markdown: string };

// A single Webex message targets EITHER a person (1:1 bot DM, toPersonEmail) OR a
// room/space (roomId) — never both — via the same POST /v1/messages endpoint.
type WebexMessageTarget = { toPersonEmail: string } | { roomId: string };

// POST the message. Isolated so sendWebexMessage and sendTestWebexMessage exercise
// the identical request (URL, Bearer auth, JSON body, ~10s timeout). The body is
// `{ roomId, markdown }` for a room target and `{ toPersonEmail, markdown }` for a
// person target — the target object is spread in verbatim. The AbortSignal.timeout
// timer is unref'd by Node, so a pending send never keeps the process alive.
function postWebexMessage(token: string, target: WebexMessageTarget, markdown: string): Promise<Response> {
  return fetch(`${webexApiBaseUrl()}/v1/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...target, markdown }),
    signal: AbortSignal.timeout(WEBEX_TIMEOUT_MS),
  });
}

/**
 * Best-effort Webex send to a person (1:1 bot DM) OR a room/space — whichever the
 * options name. NEVER throws/rejects: resolves true on success OR when the channel is
 * not effectively enabled (log-only, no network call), and false on any
 * read/transport/HTTP failure (logged, swallowed). The optional `cfgOverride` lets a
 * caller that already read the effective config (e.g. to build the template) pass it
 * through so the settings are not read a second time — exactly the mailer's
 * single-read optimization. Every log line names the TARGET (`room=<id>` vs
 * `to=<email>`); the bot token is never logged.
 */
export async function sendWebexMessage(
  options: SendWebexOptions,
  cfgOverride?: EffectiveWebexConfig
): Promise<boolean> {
  // Read each possible target field defensively: the discriminated union should make a
  // present key carry a real value, but a caller reaching PAST the types could arrive
  // with neither key (or a present key holding `undefined`).
  const roomId = 'roomId' in options ? options.roomId : undefined;
  const toPersonEmail = 'toPersonEmail' in options ? options.toPersonEmail : undefined;

  // No-target guard (defensive — the union should prevent it): NEVER POST an empty
  // recipient. Bail before any settings read or network call, returning false to match
  // the best-effort failure contract (the disabled/log-only path returns true).
  if (roomId === undefined && toPersonEmail === undefined) {
    console.error('[WEBEX] send called with no target');
    return false;
  }

  // Resolve the target: a roomId (space) when given, else the toPersonEmail (1:1 DM).
  // `label` is the log descriptor — `room=<id>` for a room, `to=<email>` for a DM — so
  // every log line reflects the target WITHOUT ever carrying the token. The guard above
  // guarantees exactly one of the two is defined here.
  const target: WebexMessageTarget =
    roomId !== undefined ? { roomId } : { toPersonEmail: toPersonEmail! };
  const label = 'roomId' in target ? `room=${target.roomId}` : `to=${target.toPersonEmail}`;

  let cfg: EffectiveWebexConfig;
  if (cfgOverride !== undefined) {
    cfg = cfgOverride;
  } else {
    try {
      cfg = await getEffectiveWebexConfig();
    } catch (err) {
      console.error(`[WEBEX] settings read failed ${label}:`, err);
      return false;
    }
  }

  if (!cfg.effectiveEnabled) {
    warnIfUndecryptableToken(cfg);
    // Disabled / tokenless / undecryptable-token: never open a socket. Dev story.
    console.log(`[WEBEX disabled] ${label}`);
    return true;
  }

  try {
    const res = await postWebexMessage(cfg.token, target, options.markdown);
    if (!res.ok) {
      // Best-effort: log the status category only (no body, no token) and swallow.
      console.error(`[WEBEX] send failed ${label} status=${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    const code = fetchCauseCode(err);
    console.error(`[WEBEX] send failed ${label}${code ? ` cause=${code}` : ''}:`, err);
    return false;
  }
}

/**
 * Max Webex sends a single notification fan-out keeps in flight (see
 * utils/concurrency.ts runBounded). Webex has no bulk "to", so a department
 * fan-out is one POST per DM recipient PLUS one per room — up to 20 + 50 = 70 for
 * a maxed-out department (the validation caps). Firing all of them at once bursts
 * outbound sockets and makes a Webex 429 (`rate_limited`) likelier, and because
 * delivery is best-effort a throttled notification is simply lost. 5 keeps a
 * realistic department (a handful of targets) effectively parallel while
 * flattening the worst case into short waves.
 */
export const WEBEX_SEND_CONCURRENCY = 5;

// ---------------------------------------------------------------------------
// ADMIN diagnostic test-send (POST /api/webex-settings/test).
//
// sendWebexMessage above keeps its opaque boolean, never-throw contract for the
// fire-and-forget notification path. The admin "Send test message" button needs
// to EXPLAIN a failure, so this dedicated path mirrors the send but returns a
// STRUCTURED result. SECURITY (the whole point): the `reason` is ALWAYS one of the
// fixed WebexFailureReason codes below, derived ONLY from the HTTP status (and a
// keyword scan of a 400 body to distinguish an unknown recipient), or from the
// thrown error's kind and its low-level undici cause code — NEVER from response
// text or the token. The client receives a CATEGORY; the full error stays in the
// server log. Mirrors the mailer's MailFailureReason discipline.
// ---------------------------------------------------------------------------

/**
 * Fixed failure categories the admin UI can translate. NEVER free-form text.
 *
 * Webex-specific buckets: `invalid_token` (a rejected Bearer credential — 401/403,
 * the analogue of mail's auth_failed), `recipient_not_found` (the toPersonEmail is
 * not a Webex user), and `rate_limited` (HTTP 429). The transport buckets MIRROR
 * the mail channel's MailFailureReason so both test buttons are equally actionable:
 * `host_not_found` (DNS), `connection_refused`, `tls_error`, and `timeout`, with
 * `connection_failed` kept as the GENERIC transport fallback used only when the
 * low-level cause code names no specific bucket. `config_error` = disabled / not
 * configured (no network call); `unknown` = anything else.
 *
 * SECURITY: a returned value is ALWAYS one of these fixed codes. The HTTP status
 * and the low-level cause code only SELECT which code to return — neither the
 * status, the cause code, any response text, nor the token is ever placed into the
 * reason or any API response.
 */
export type WebexFailureReason =
  | 'invalid_token'
  | 'recipient_not_found'
  | 'rate_limited'
  | 'timeout'
  | 'host_not_found'
  | 'connection_refused'
  | 'tls_error'
  | 'connection_failed'
  | 'config_error'
  | 'unknown';

/**
 * Structured outcome of a diagnostic test send. `{ ok: true }` on success; on
 * failure `{ ok: false, reason }` with a fixed category. (This `{ ok, reason }`
 * shape is the Webex analogue of the mailer's MailTestResult.)
 */
export type WebexTestResult = { ok: true } | { ok: false; reason: WebexFailureReason };

// Map a non-OK Response to ONE fixed reason category. Reads the body ONLY for a
// 400 (to tell an unknown recipient apart from a generic bad request) and only to
// CATEGORIZE — the body text never reaches the client.
async function mapWebexResponseFailure(res: Response): Promise<WebexFailureReason> {
  if (res.status === 401 || res.status === 403) return 'invalid_token';
  if (res.status === 404) return 'recipient_not_found';
  if (res.status === 429) return 'rate_limited';
  if (res.status === 400) {
    let body = '';
    try {
      body = await res.text();
    } catch {
      body = '';
    }
    // Webex answers an unknown toPersonEmail with a 400 whose message names the
    // person/email; categorize (never surface) that as recipient_not_found.
    if (/person|email|recipient|not found|unable to (?:find|create)/i.test(body)) {
      return 'recipient_not_found';
    }
    return 'unknown';
  }
  return 'unknown';
}

// Node/undici certificate-validation codes that indicate a TLS failure but do NOT
// carry the ERR_TLS / ERR_SSL prefix. Kept in one place so the tls_error bucket
// below matches the mail channel's certificate handling exactly.
const TLS_CERT_ERROR_CODES = new Set<string>([
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

// Bucket a low-level undici cause code (see fetchCauseCode) into ONE fixed
// transport reason, MIRRORING mapMailFailure in ../utils/mailer so the Webex test
// button distinguishes DNS / refused connect / TLS exactly as the mail test button
// does. Returns undefined when the code names no known transport bucket, letting
// the caller fall back on the error kind. Derived ONLY from the code string — the
// code is used solely to SELECT a fixed category and is never surfaced in it.
function transportReasonFromCauseCode(code: string | undefined): WebexFailureReason | undefined {
  if (code === undefined) return undefined;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EDNS') return 'host_not_found';
  if (code === 'ECONNREFUSED') return 'connection_refused';
  if (code === 'ETIMEDOUT') return 'timeout';
  if (code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL') || TLS_CERT_ERROR_CODES.has(code)) {
    return 'tls_error';
  }
  return undefined;
}

// Map a thrown fetch error to ONE fixed reason category, derived ONLY from the
// error's kind and the low-level undici cause code (never from any message text or
// the token). An AbortSignal timeout (or any abort) -> timeout. Otherwise the cause
// code selects the specific transport bucket, MIRRORING the mail channel's
// mapMailFailure: ENOTFOUND / EAI_AGAIN / EDNS -> host_not_found, ECONNREFUSED ->
// connection_refused, ETIMEDOUT -> timeout, a TLS/SSL/cert code -> tls_error. With
// no matching cause code a generic fetch network failure (a TypeError, e.g. "fetch
// failed") -> connection_failed; anything else -> unknown.
function mapWebexThrownFailure(err: unknown): WebexFailureReason {
  const name = typeof (err as { name?: unknown } | null)?.name === 'string'
    ? (err as { name: string }).name
    : '';
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';

  const bucketed = transportReasonFromCauseCode(fetchCauseCode(err));
  if (bucketed !== undefined) return bucketed;

  if (err instanceof TypeError) return 'connection_failed';
  return 'unknown';
}

// undici wraps a low-level connect/DNS/TLS failure in TypeError('fetch failed')
// whose `.cause` carries the real code (ECONNREFUSED / ENOTFOUND / a TLS error
// code, ...). That code is BOTH logged in the [WEBEX] line (so an admin can tell
// DNS apart from a refused connect or a TLS error) AND fed to
// transportReasonFromCauseCode to SELECT the specific reason bucket
// (host_not_found / connection_refused / tls_error). It only ever selects a fixed
// category — the raw code never lands in the returned reason, and the token is
// never logged.
function fetchCauseCode(err: unknown): string | undefined {
  const cause = (err as { cause?: unknown } | null)?.cause;
  const code = (cause as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

// A stored token that will not decrypt (wrong/rotated key) makes the channel not
// effectively enabled; warn once per send attempt so the misconfiguration is
// visible. Never logs the token (or the ciphertext).
function warnIfUndecryptableToken(cfg: EffectiveWebexConfig): void {
  if (cfg.enabled && cfg.hasToken && !cfg.tokenDecryptable) {
    console.warn(
      '[WEBEX] a stored bot token could not be decrypted (check MAIL_SETTINGS_KEY); Webex is treated as not configured.'
    );
  }
}

/**
 * Diagnostic send used ONLY by POST /api/webex-settings/test. Mirrors
 * sendWebexMessage's config-read + request but reports a structured
 * WebexTestResult the admin UI can explain. Like sendWebexMessage it never throws.
 *
 *   - settings read throws / disabled / tokenless  -> { ok: false, config_error }
 *     (NO network call — the config_error category covers "not configured")
 *   - send succeeds (2xx)                           -> { ok: true }
 *   - send returns non-OK / throws                  -> { ok: false, <mapped> }
 *
 * The full error is logged server-side via console.error; the client only ever
 * receives the fixed reason category.
 */
export async function sendTestWebexMessage(to: string): Promise<WebexTestResult> {
  let cfg: EffectiveWebexConfig;
  try {
    cfg = await getEffectiveWebexConfig();
  } catch (err) {
    console.error(`[WEBEX] test settings read failed to=${to}:`, err);
    return { ok: false, reason: 'config_error' };
  }

  if (!cfg.effectiveEnabled) {
    warnIfUndecryptableToken(cfg);
    // Disabled / tokenless / undecryptable-token: never open a socket. This is the
    // config_error-style "not configured" outcome the admin UI explains.
    console.log(`[WEBEX disabled] test to=${to}`);
    return { ok: false, reason: 'config_error' };
  }

  try {
    const res = await postWebexMessage(cfg.token, { toPersonEmail: to }, TEST_MESSAGE_MARKDOWN);
    if (res.ok) return { ok: true };
    const reason = await mapWebexResponseFailure(res);
    console.error(`[WEBEX] test send failed to=${to} status=${res.status}`);
    return { ok: false, reason };
  } catch (err) {
    const code = fetchCauseCode(err);
    console.error(`[WEBEX] test send failed to=${to}${code ? ` cause=${code}` : ''}:`, err);
    return { ok: false, reason: mapWebexThrownFailure(err) };
  }
}

// ---------------------------------------------------------------------------
// List the rooms/spaces the bot belongs to (GET /api/webex-settings/rooms).
//
// Powers the admin's room picker: the FE renders the returned rooms and always also
// offers manual entry of a room id. Mirrors sendTestWebexMessage's discipline — a
// single effective-config read, a ~10s AbortSignal, never-throw, and on failure a
// FIXED WebexFailureReason category (an HTTP non-OK via the rooms-specific
// mapWebexRoomsFailure below, a thrown transport error via the shared
// mapWebexThrownFailure) so the full error stays in the server log. SECURITY: the bot
// token is the Bearer credential only; it is NEVER placed in the returned value
// (neither the rooms nor the reason carry it).
// ---------------------------------------------------------------------------

/** The minimal room shape the picker needs — mapped from a Webex `items[]` entry. */
export interface WebexRoom {
  id: string;
  title: string;
}

/**
 * Structured outcome of a rooms listing. `{ ok: true, rooms }` on success;
 * `{ ok: false, reason }` (a FIXED category) when the channel is not effectively
 * enabled (config_error, no network call) or the GET fails. NEVER carries the token.
 */
export type WebexRoomsResult =
  | { ok: true; rooms: WebexRoom[] }
  | { ok: false; reason: WebexFailureReason };

// GET the bot's rooms. Isolated (like postWebexMessage) so the URL, Bearer auth and
// ~10s timeout live in one place. Unref'd AbortSignal timer, so a pending fetch never
// keeps the process alive.
//
// The query pins the listing to what the picker needs: `type=group` returns only group
// SPACES (excluding the bot's 1:1 `direct` rooms, which are not pickable targets), and
// `max=1000` pulls a bot in many spaces back in a SINGLE page. There is deliberately NO
// Link-header pagination here, so a bot in >1000 group spaces is truncated to the first
// 1000 — an accepted limit for an admin room picker.
function getWebexRooms(token: string): Promise<Response> {
  return fetch(`${webexApiBaseUrl()}/v1/rooms?type=group&max=1000`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(WEBEX_TIMEOUT_MS),
  });
}

// Map a successful Webex /v1/rooms body to WebexRoom[] — or NULL when the body could
// not be parsed as a room listing (a non-JSON body, or an `items` that is missing / not
// an array). NULL means "couldn't parse" and the caller maps it to a failure; it is
// DISTINCT from a genuine empty listing (`items: []` -> [], an OK zero-room result), so
// the FE can tell a real empty list apart from a fetch that returned junk. Never throws.
// Within a valid listing an item with a missing/empty/non-string `id` is SKIPPED, and an
// item whose `title` is missing/empty/non-string falls back to its `id` as the label so
// the picker always has something to render. Only `id` and `title` are carried through —
// every other field is ignored, and the token is not part of the body at all.
async function parseWebexRooms(res: Response): Promise<WebexRoom[] | null> {
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return null; // body was not JSON — a parse failure, NOT a zero-room listing
  }
  const items = (payload as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return null; // `items` missing / not an array — parse failure
  const rooms: WebexRoom[] = [];
  for (const item of items) {
    const id = (item as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || id.length === 0) continue;
    const rawTitle = (item as { title?: unknown } | null)?.title;
    // A titleless (or empty/non-string-title) room falls back to its id as the label.
    rooms.push({ id, title: typeof rawTitle === 'string' && rawTitle.length > 0 ? rawTitle : id });
  }
  return rooms;
}

// Map a non-OK Webex /v1/rooms Response to ONE fixed reason category. UNLIKE the
// message-send mapper (mapWebexResponseFailure), a LISTING has no recipient, so there is
// NO 404->recipient_not_found and NO 400-body keyword sniff: 401/403 -> the Bearer
// credential was rejected (invalid_token), 429 -> rate_limited, and ANY other non-OK
// status -> unknown. Synchronous (no body read): the response body never influences the
// category and never reaches the client — only the fixed code is returned.
function mapWebexRoomsFailure(res: Response): WebexFailureReason {
  if (res.status === 401 || res.status === 403) return 'invalid_token';
  if (res.status === 429) return 'rate_limited';
  return 'unknown';
}

/**
 * Best-effort listing of the rooms the bot is a member of. NEVER throws.
 *
 *   - settings read throws / disabled / tokenless -> { ok: false, config_error }
 *     (NO network call — config_error covers "not configured")
 *   - GET succeeds (2xx), body parses             -> { ok: true, rooms }
 *   - GET succeeds (2xx) but body is unparseable  -> { ok: false, unknown }
 *     (non-JSON, or `items` missing/not an array — distinct from a genuine empty list)
 *   - GET returns non-OK / throws                 -> { ok: false, <mapped> }
 *
 * The full error is logged server-side; the caller only ever receives rooms or a
 * fixed reason category. The token is NEVER included in the result.
 */
export async function listWebexRooms(): Promise<WebexRoomsResult> {
  let cfg: EffectiveWebexConfig;
  try {
    cfg = await getEffectiveWebexConfig();
  } catch (err) {
    console.error('[WEBEX] rooms settings read failed:', err);
    return { ok: false, reason: 'config_error' };
  }

  if (!cfg.effectiveEnabled) {
    warnIfUndecryptableToken(cfg);
    // Disabled / tokenless / undecryptable-token: never open a socket.
    console.log('[WEBEX disabled] rooms');
    return { ok: false, reason: 'config_error' };
  }

  try {
    const res = await getWebexRooms(cfg.token);
    if (!res.ok) {
      const reason = mapWebexRoomsFailure(res);
      console.error(`[WEBEX] rooms fetch failed status=${res.status}`);
      return { ok: false, reason };
    }
    // A 2xx whose body could not be parsed (parseWebexRooms -> null) is NOT an empty
    // listing — surface it as a failure so the FE can distinguish junk from zero rooms.
    const rooms = await parseWebexRooms(res);
    if (rooms === null) return { ok: false, reason: 'unknown' };
    return { ok: true, rooms };
  } catch (err) {
    const code = fetchCauseCode(err);
    console.error(`[WEBEX] rooms fetch failed${code ? ` cause=${code}` : ''}:`, err);
    return { ok: false, reason: mapWebexThrownFailure(err) };
  }
}
