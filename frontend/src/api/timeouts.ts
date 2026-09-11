// HTTP timeouts for the axios client. Deliberately NOT in client.ts: tests mock
// that module with a factory returning only `default`, so a named export there
// would force every such test to re-declare this constant.

// Covers every ordinary endpoint — they only read Mongo — and matches the
// backend's own convention for bounded work (JIRA_TIMEOUT_MS, WEBEX_TIMEOUT_MS
// and SMTP_TIMEOUT_MS are all 10s). Axios otherwise defaults to 0, meaning wait
// forever, which lets one stalled request hang its caller indefinitely.
export const DEFAULT_TIMEOUT_MS = 10_000;

// For routes whose handler makes its own outbound call (Jira / Webex / SMTP) and
// so can legitimately take far longer than a database read.
//
// MUST stay above the backend's own bound for those calls (10s: JIRA_TIMEOUT_MS,
// WEBEX_TIMEOUT_MS, SMTP_TIMEOUT_MS). Those endpoints answer 200 with a structured
// { ok: false, reason } that the UI renders as a specific message; if the client
// gave up first the user would get a generic network error instead. The headroom
// also covers a request spanning several phases — SMTP alone has separate
// connection, greeting and socket timeouts.
export const EXTERNAL_CALL_TIMEOUT_MS = 30_000;
