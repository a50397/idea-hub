import { z } from 'zod';
import { Effort, IdeaStatus } from '@prisma/client';

const ideaStatusEnum = z.nativeEnum(IdeaStatus);
export const objectIdRegex = /^[a-f\d]{24}$/i;

export const objectIdParamSchema = z.string().regex(objectIdRegex, 'Invalid ID format');

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const createIdeaSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters').max(120, 'Title must be at most 120 characters'),
  description: z.string().min(10, 'Description must be at least 10 characters').max(3000, 'Description must be at most 3000 characters'),
  benefits: z.string().min(10, 'Benefits must be at least 10 characters').max(3000, 'Benefits must be at most 3000 characters'),
  effort: z.nativeEnum(Effort, { errorMap: () => ({ message: 'Invalid effort value' }) }),
  tags: z.array(z.string()).optional().default([]),
  // departmentId is optional in the Prisma schema (legacy docs) but REQUIRED here:
  // every new idea targets a department. Existence is verified in the handler.
  departmentId: z.string().regex(objectIdRegex, 'Invalid department ID'),
  // Optional submitter opt-in to lifecycle mail. Absent -> the create handler
  // persists the strict-opt-out default (false).
  notifyOnChange: z.boolean().optional(),
});

// PATCH /api/ideas/:id/notify — the submitter flips their lifecycle-mail opt-in.
export const notifyToggleSchema = z.object({
  enabled: z.boolean(),
});

export const updateIdeaSchema = z.object({
  title: z.string().min(5).max(120).optional(),
  description: z.string().min(10).max(3000).optional(),
  benefits: z.string().min(10).max(3000).optional(),
  effort: z.nativeEnum(Effort).optional(),
  tags: z.array(z.string()).optional(),
  departmentId: z.string().regex(objectIdRegex, 'Invalid department ID').optional(),
});

export const departmentNameSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be at most 100 characters'),
});

// A Webex room id is an OPAQUE, non-whitespace token. This regex matches any character
// that must never appear inside one: \s (space, tab, CR, LF, form/vertical
// feed, and Unicode whitespace) plus the remaining C0 control range (\u0000-\u001f)
// and DEL (\u007f). Rejecting these closes a log-forging vector: a newline in an
// id would otherwise forge '[WEBEX]' log lines. It also rejects malformed pastes;
// base64 / base64url ids (A-Z a-z 0-9 and - _ + / =) contain none of these.
const webexRoomIdForbiddenChar = /[\s\u0000-\u001f\u007f]/;

// A Jira PROJECT key: a letter followed by letters/digits/underscores (Atlassian's
// own rule), stored UPPERCASE because Jira treats keys as uppercase. Declared here
// (above its first use) and SHARED by the per-department override in
// updateDepartmentSchema below and the installation-wide default in
// updateJiraSettingsSchema, so the two rules can never drift apart. An empty string
// is allowed by both callers and means "no key" (the department PATCH turns it into
// null; the settings PUT stores '').
const jiraProjectKeySchema = z
  .string()
  .trim()
  .max(32, 'Project key must be at most 32 characters')
  .refine((v) => v === '' || /^[A-Za-z][A-Za-z0-9_]*$/.test(v), {
    message: 'Project key must start with a letter and contain only letters, digits or underscores',
  })
  .transform((v) => v.toUpperCase());

// PATCH /api/departments/:id accepts a rename, a notification-emails update, a
// webex-room-ids update, or any combination — every field is optional, so a
// single-field request works for each. Each notification email is trimmed then
// validated; the raw array is capped at 20 entries; valid entries are de-duplicated
// CASE-INSENSITIVELY. Each webex room id is trimmed and (up to 256 chars) capped, the
// raw array is capped at 50, blank entries are dropped, and the rest are de-duplicated
// CASE-SENSITIVELY (room ids are opaque). An empty array is allowed for either list
// and clears it.
export const updateDepartmentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must be at most 100 characters')
    .optional(),
  notificationEmails: z
    .array(z.string().trim().email('Invalid notification email address'))
    .max(20, 'At most 20 notification emails are allowed')
    // De-duplicate case-INSENSITIVELY (so 'User@X.com' and 'user@x.com' collapse to
    // one) while PRESERVING the first occurrence's original casing. Email local-
    // parts are technically case-sensitive, so we never lowercase what gets stored —
    // we only drop later case-variant duplicates. Order is preserved.
    .transform((emails) => {
      const seen = new Set<string>();
      const deduped: string[] = [];
      for (const email of emails) {
        const key = email.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(email);
        }
      }
      return deduped;
    })
    .optional(),
  webexRoomIds: z
    // Each id is trimmed, length-capped (a Webex room id is opaque — no format to
    // validate), then checked for forbidden characters. The item schema allows an empty
    // (post-trim) string so a stray blank line from a paste does not 400 the whole
    // array; the transform DROPS it. The raw array is capped at 50 (mirroring
    // notificationEmails' max on the raw count).
    .array(
      z
        .string()
        .trim()
        .max(256, 'Each Webex room ID must be at most 256 characters')
        // Opaque, NON-whitespace ids: reject any embedded whitespace or control char
        // (webexRoomIdForbiddenChar). A newline in an id could otherwise forge '[WEBEX]'
        // log lines (log injection); any such char also signals a malformed paste.
        // Leading/trailing whitespace was already trimmed above, so a blank (post-trim
        // '') entry still passes here and is dropped by the transform below.
        .refine((id) => !webexRoomIdForbiddenChar.test(id), {
          message: 'Webex room IDs cannot contain whitespace or control characters',
        })
    )
    .max(50, 'At most 50 Webex room IDs are allowed')
    // Drop blank entries (empty after trim) and de-duplicate. Room ids are OPAQUE, so
    // unlike the case-insensitive email dedupe they are compared CASE-SENSITIVELY
    // (exact match) — 'ROOM-A' and 'room-a' are DISTINCT rooms. Order is preserved and
    // the first occurrence kept.
    .transform((ids) => {
      const seen = new Set<string>();
      const deduped: string[] = [];
      for (const id of ids) {
        if (id.length === 0) continue; // already trimmed by the item schema; drop blanks
        if (!seen.has(id)) {
          seen.add(id);
          deduped.push(id);
        }
      }
      return deduped;
    })
    .optional(),
  // Optional per-department Jira project override. Same key rule as the
  // installation-wide default (jiraProjectKeySchema, uppercased); an EMPTY STRING is
  // the explicit CLEAR signal, which the route turns into null so the effective
  // project falls back to JiraSettings.defaultProjectKey.
  jiraProjectKey: jiraProjectKeySchema.optional(),
});

export const reorderDepartmentsSchema = z.object({
  ids: z.array(z.string()).min(1, 'ids must be a non-empty array'),
});

// PUT /api/mail-settings — full save of the singleton admin-managed mail config.
// `password` is the ONLY optional field: when present and non-empty it is
// encrypted and stored; when absent or empty the existing stored password is kept
// (or wiped when `username` is saved empty). The enabled-requires-host rule is
// enforced in the route handler so it can return a house-style message. `host` is
// bounded to the max DNS name length (253); `from`/`username`/`subjectTemplate`
// are trimmed and bounded; `language` is the en|sk enum.
export const updateMailSettingsSchema = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(253, 'Host must be at most 253 characters'),
  port: z
    .number({ invalid_type_error: 'Port must be a number' })
    .int('Port must be an integer')
    .min(1, 'Port must be at least 1')
    .max(65535, 'Port must be at most 65535'),
  secure: z.boolean(),
  username: z.string().trim().max(128, 'Username must be at most 128 characters'),
  password: z.string().max(256, 'Password must be at most 256 characters').optional(),
  from: z
    .string()
    .trim()
    .min(1, 'From address is required')
    .max(128, 'From address must be at most 128 characters'),
  language: z.enum(['en', 'sk'], { errorMap: () => ({ message: 'Language must be en or sk' }) }),
  subjectTemplate: z
    .string()
    .trim()
    .max(200, 'Subject template must be at most 200 characters'),
});

// POST /api/mail-settings/test — send a short test mail to a single address.
export const mailTestSendSchema = z.object({
  to: z.string().trim().email('Invalid email address'),
});

// PUT /api/webex-settings — full save of the singleton admin-managed Webex config.
// `token` is the ONLY optional field and drives keep/set/wipe of the stored bot
// token (the Webex analogue of the mail password): ABSENT keeps the existing
// token, a NON-EMPTY value is TRIMMED then encrypted and stored, and an EMPTY
// STRING wipes it. A whitespace-only (non-empty) token is REJECTED at validation —
// trimmed it would leave nothing to store, yet effectiveEnabled (token.length > 0)
// would still read true, i.e. an "enabled" channel with an unusable credential.
// (Unlike mail there is no username to key the wipe off, so the empty-string token
// is itself the wipe signal; and unlike the mail password — which may legitimately
// contain surrounding spaces and is deliberately NOT trimmed — the bot token is
// trimmed.) `language` is the en|sk enum; the token is bounded generously so a long
// Webex bot token is never rejected.
export const updateWebexSettingsSchema = z.object({
  enabled: z.boolean(),
  language: z.enum(['en', 'sk'], { errorMap: () => ({ message: 'Language must be en or sk' }) }),
  token: z
    .string()
    .max(512, 'Token must be at most 512 characters')
    // A whitespace-only token would encrypt to an unusable credential yet still make
    // effectiveEnabled true (token.length > 0). Reject it; the empty string stays the
    // explicit WIPE signal, and a real token is trimmed before it is encrypted/stored.
    .refine((v) => v === '' || v.trim().length > 0, {
      message: 'Token cannot be only whitespace',
    })
    .transform((v) => (v === '' ? '' : v.trim()))
    .optional(),
});

// POST /api/webex-settings/test — send a short test Webex DM to a single address.
export const webexTestSendSchema = z.object({
  to: z.string().trim().email('Invalid email address'),
});

// ---------------------------------------------------------------------------
// Jira integration (PUT /api/jira-settings, PATCH /api/departments/:id)
// ---------------------------------------------------------------------------

// Is this hostname an IP LITERAL rather than a name? URL.hostname renders an IPv6
// literal in brackets; the numeric forms cover dotted-quad IPv4 and the hex/decimal
// spellings a URL parser also accepts.
function isIpLiteralHost(hostname: string): boolean {
  if (hostname.startsWith('[')) return true; // IPv6 literal, e.g. [::1]
  if (/^[0-9.]+$/.test(hostname)) return true; // 127.0.0.1, 2130706433, 127.1 ...
  if (/^0x[0-9a-f]+$/i.test(hostname)) return true; // hex spelling of an IPv4
  return false;
}

// Loopback-by-name. Combined with isIpLiteralHost this closes the obvious
// "point the stored credential at something local" cases (see below).
//
// The trailing dot is NOT cosmetic: "localhost." is the fully qualified (root-label)
// spelling of the SAME name, it resolves the same way, and URL keeps it verbatim —
// `new URL('https://localhost.').hostname === 'localhost.'`. Comparing the raw
// hostname therefore let "https://localhost." and "https://jira.localhost." straight
// through the check. One trailing dot is stripped before comparing, which is what a
// resolver does with it. (The numeric spellings need no such treatment: a trailing
// dot does not stop URL from canonicalizing them to a dotted quad, so
// "https://0x7f000001." still reaches isIpLiteralHost as "127.0.0.1".)
function isLocalhostName(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return host === 'localhost' || host.endsWith('.localhost');
}

/**
 * The Jira site base URL — the single most security-sensitive field in this feature
 * (security review F1).
 *
 * The stored account email + API token are sent as an HTTP Basic header to WHATEVER
 * ORIGIN this names, so an admin (or anyone who reaches this endpoint) could
 * otherwise turn the setting into a credential-exfiltration primitive, and the same
 * value is also the base of the browse URL the SPA renders as a link. Hence:
 *   - https ONLY (no http, and emphatically no javascript:/data: — which is what
 *     would make the browse link stored XSS),
 *   - no userinfo (https://user:pass@host would smuggle a second credential),
 *   - no query or fragment (they cannot belong to an origin),
 *   - no IP literal and no localhost host (blunts the obvious SSRF-to-loopback
 *     shape; a full SSRF filter is out of scope — the outbound call additionally
 *     refuses redirects, see utils/jira.ts),
 *   - stored NORMALIZED to a bare origin (scheme://host[:port]), so any path is
 *     dropped and every join in utils/jira.ts is well-formed.
 * An empty string is allowed and means "not configured" (the effective config then
 * reads as not enabled). The e2e/test story does NOT relax this rule: it uses the
 * JIRA_API_BASE_URL environment override instead (config/jira.ts).
 */
const jiraBaseUrlSchema = z
  .string()
  .trim()
  .max(200, 'Base URL must be at most 200 characters')
  .superRefine((value, ctx) => {
    if (value === '') return; // not configured
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Base URL must be a valid absolute URL' });
      return;
    }
    if (parsed.protocol !== 'https:') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Base URL must use https' });
    }
    if (parsed.username.length > 0 || parsed.password.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Base URL must not contain credentials' });
    }
    if (parsed.search.length > 0 || parsed.hash.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Base URL must not contain a query string or fragment',
      });
    }
    if (isIpLiteralHost(parsed.hostname)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Base URL must name a host, not an IP address' });
    } else if (isLocalhostName(parsed.hostname)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Base URL must not point at localhost' });
    }
  })
  // Normalize to the bare origin. Only reached for a value that passed every check
  // above (a failed refinement short-circuits the pipeline); the try/catch keeps it
  // total regardless.
  .transform((value) => {
    if (value === '') return '';
    try {
      return new URL(value).origin;
    } catch {
      return value;
    }
  });

// PUT /api/jira-settings — full save of the singleton admin-managed Jira config.
// `apiToken` is the ONLY optional field and drives keep/set/wipe of the stored API
// token exactly like the Webex bot token: ABSENT keeps the existing token, a
// NON-EMPTY value is TRIMMED then encrypted and stored, and an EMPTY STRING wipes
// it. A whitespace-only token is REJECTED (trimmed it would leave nothing to store,
// yet effectiveEnabled would still read true — an "enabled" channel with an
// unusable credential).
//
// NOTE: the F2 credential-binding rule ("changing baseUrl or email REQUIRES setting
// or wiping the token") is NOT expressible here — it compares the request against
// the STORED document — so it lives in the route handler, which can also return the
// house-style message. This schema only validates each field in isolation.
export const updateJiraSettingsSchema = z.object({
  enabled: z.boolean(),
  baseUrl: jiraBaseUrlSchema,
  email: z
    .string()
    .trim()
    .max(128, 'Email must be at most 128 characters')
    .refine((v) => v === '' || z.string().email().safeParse(v).success, {
      message: 'Invalid email address',
    }),
  apiToken: z
    .string()
    .max(512, 'API token must be at most 512 characters')
    .refine((v) => v === '' || v.trim().length > 0, {
      message: 'API token cannot be only whitespace',
    })
    .transform((v) => (v === '' ? '' : v.trim()))
    .optional(),
  defaultProjectKey: jiraProjectKeySchema,
  issueTypeName: z
    .string()
    .trim()
    .min(1, 'Issue type is required')
    .max(100, 'Issue type must be at most 100 characters'),
  pollIntervalMinutes: z
    .number({ invalid_type_error: 'Poll interval must be a number' })
    .int('Poll interval must be an integer')
    .min(1, 'Poll interval must be at least 1 minute')
    .max(1440, 'Poll interval must be at most 1440 minutes'),
  cancelResolutions: z
    .string()
    .trim()
    .max(500, 'Cancel resolutions must be at most 500 characters'),
});

export const reviewIdeaSchema = z.object({
  note: z.string().max(1000).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(12, 'New password must be at least 12 characters'),
});

export const createStepSchema = z.object({
  text: z.string().min(1, 'Step text is required').max(1000, 'Step text must be at most 1000 characters'),
});

export const createUserSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  role: z.enum(['USER', 'POWER_USER', 'ADMIN']).optional().default('USER'),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  password: z.string().min(12).optional(),
  role: z.enum(['USER', 'POWER_USER', 'ADMIN']).optional(),
});

const paginationSchema = {
  page: z.coerce.number().int().min(1, 'Page must be at least 1').optional().default(1),
  limit: z.coerce.number().int().min(1, 'Limit must be at least 1').max(100, 'Limit must be at most 100').optional().default(20),
};

export const ideasQuerySchema = z.object({
  status: ideaStatusEnum.optional(),
  submitterId: z.string().regex(objectIdRegex, 'Invalid submitter ID').optional(),
  assigneeId: z.string().regex(objectIdRegex, 'Invalid assignee ID').optional(),
  departmentId: z.string().regex(objectIdRegex, 'Invalid department ID').optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  ...paginationSchema,
});

export const filteredReportQuerySchema = z.object({
  status: ideaStatusEnum.optional(),
  submitterId: z.string().regex(objectIdRegex, 'Invalid submitter ID').optional(),
  assigneeId: z.string().regex(objectIdRegex, 'Invalid assignee ID').optional(),
  departmentId: z.string().regex(objectIdRegex, 'Invalid department ID').optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  startDate: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  endDate: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  format: z.enum(['json', 'csv']).optional(),
  ...paginationSchema,
});
