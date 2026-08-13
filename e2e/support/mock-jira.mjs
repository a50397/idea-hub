// Minimal Jira Cloud REST v3 stand-in for E2E, mirroring the mock-idp.mjs launch
// pattern (plain node:http; no third-party library needed since the Jira REST
// surface this app calls is small enough to hand-roll). Started by Playwright's
// webServer as:
//   node e2e/support/mock-jira.mjs
//
// Implements exactly the endpoints backend/src/utils/jira.ts calls (issue create,
// JQL search, single-issue read, /myself, project search) plus `__test__` control
// routes the specs use to script status transitions, deletions and a full reset
// between runs. State is entirely in-memory and never persisted, so a restart (or
// a `/__test__/reset` call) clears every issue.
import http from 'node:http';

const port = Number(process.env.MOCK_JIRA_PORT || 8098);

// The exact Basic-auth credential every REAL Jira endpoint below requires (the
// production-shaped ones — the `__test__` control routes below are unauthenticated
// since they are not part of the app's outbound surface). Every e2e spec that
// configures Jira settings (through the admin UI or the API) MUST use this same
// email/token pair — see support/config.ts MOCK_JIRA_IDENTITY, which is also what
// is injected here via env. A mismatch fails loudly (401) instead of silently,
// which is what turns "clicking through the real UI succeeds" into an implicit,
// end-to-end proof that the backend sent the Basic header we configured.
const expectedEmail = process.env.MOCK_JIRA_EMAIL || 'jira-bot@ideahub.example';
const expectedToken = process.env.MOCK_JIRA_API_TOKEN || 'e2e-mock-jira-api-token';
const expectedAuth = `Basic ${Buffer.from(`${expectedEmail}:${expectedToken}`, 'utf8').toString('base64')}`;

/** @typedef {{id:string,key:string,statusName:string,categoryKey:'new'|'indeterminate'|'done',assignee:string|null,resolution:string|null,deleted:boolean}} MockIssue */

/** @type {Map<string, MockIssue>} */
let issues = new Map();
let nextId = 90001;
/** Per-project running counter so keys read naturally (OPS-1, OPS-2, ...). */
let projectCounters = new Map();

function resetState() {
  issues = new Map();
  nextId = 90001;
  projectCounters = new Map();
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.length === 0) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
  });
}

function send(res, status, body) {
  const payload = JSON.stringify(body ?? {});
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function isAuthorized(req) {
  return req.headers.authorization === expectedAuth;
}

/** self-link, shared by every issue representation below. */
function issueSelf(issue) {
  return `http://localhost:${port}/rest/api/3/issue/${issue.id}`;
}

/** Full representation (all three mirrored sub-fields), used by the single-issue GET. */
function issuePayload(issue) {
  return {
    id: issue.id,
    key: issue.key,
    self: issueSelf(issue),
    fields: {
      status: { name: issue.statusName, statusCategory: { key: issue.categoryKey } },
      assignee: issue.assignee === null ? null : { displayName: issue.assignee },
      resolution: issue.resolution === null ? null : { name: issue.resolution },
    },
  };
}

/**
 * Search-result issue representation, honoring the caller's `fields` selection like
 * the real POST /rest/api/3/search/jql: the default projection (fields absent or
 * empty) is `id` only, so status/assignee/resolution come back ONLY when explicitly
 * requested. utils/jira.ts always requests all three ("MANDATORY: without this the
 * response carries ids only" at the call site) — a regression that dropped that
 * array would make every issue come back with no status here too, so the poller's
 * transition matrix would stall exactly as it would against real Jira instead of
 * shipping e2e-green over a silently broken request.
 */
function issueSearchPayload(issue, requestedFields) {
  const wanted = new Set(Array.isArray(requestedFields) ? requestedFields : []);
  const fields = {};
  if (wanted.has('status')) fields.status = { name: issue.statusName, statusCategory: { key: issue.categoryKey } };
  if (wanted.has('assignee')) fields.assignee = issue.assignee === null ? null : { displayName: issue.assignee };
  if (wanted.has('resolution')) fields.resolution = issue.resolution === null ? null : { name: issue.resolution };
  return { id: issue.id, key: issue.key, self: issueSelf(issue), fields };
}

/** Locate a mock issue by its numeric id OR its human key (control routes only). */
function findIssue(idOrKey) {
  if (idOrKey === undefined || idOrKey === null) return undefined;
  if (issues.has(idOrKey)) return issues.get(idOrKey);
  for (const issue of issues.values()) {
    if (issue.key === idOrKey) return issue;
  }
  return undefined;
}

async function handle(req, res) {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const pathname = url.pathname;
  const method = req.method ?? 'GET';
  const body = await readBody(req);

  // --- Real Jira REST v3 surface (Basic-auth gated, matches utils/jira.ts) -------

  // Create an issue: POST /rest/api/3/issue -> { id, key, self }.
  if (method === 'POST' && pathname === '/rest/api/3/issue') {
    if (!isAuthorized(req)) return send(res, 401, { errorMessages: ['Unauthorized'] });
    const projectKey = body?.fields?.project?.key;
    if (typeof projectKey !== 'string' || projectKey.length === 0) {
      return send(res, 400, { errorMessages: ["The project key 'null' does not exist"] });
    }
    // Real Jira REST v3 requires the description in Atlassian Document Format
    // (ADF); a plain string is rejected with 400. Enforcing the same shape here is
    // what turns a regression in plainTextToAdf() (utils/jira.ts) into a failing
    // e2e run instead of a mock that stays green while real Jira would 400.
    const description = body?.fields?.description;
    if (!description || typeof description !== 'object' || description.type !== 'doc' || description.version !== 1) {
      return send(res, 400, {
        errorMessages: ['The description field must be represented in Atlassian Document Format (ADF)'],
      });
    }
    const n = (projectCounters.get(projectKey) ?? 0) + 1;
    projectCounters.set(projectKey, n);
    const id = String(nextId++);
    const issue = {
      id,
      key: `${projectKey}-${n}`,
      statusName: 'To Do',
      categoryKey: 'new',
      assignee: null,
      resolution: null,
      deleted: false,
    };
    issues.set(id, issue);
    // Real Jira's create response carries no `fields` — only id/key/self. Serving
    // more than that here would invite an e2e-green/prod-broken dependency on a
    // field the real endpoint never returns.
    return send(res, 201, { id: issue.id, key: issue.key, self: issueSelf(issue) });
  }

  // Poll surface: POST /rest/api/3/search/jql, bounded `id in (...)` JQL only.
  if (method === 'POST' && pathname === '/rest/api/3/search/jql') {
    if (!isAuthorized(req)) return send(res, 401, { errorMessages: ['Unauthorized'] });
    const jql = typeof body?.jql === 'string' ? body.jql : '';
    const ids = jql.match(/\d+/g) ?? [];
    const requestedFields = body?.fields;
    const found = ids
      .map((id) => issues.get(id))
      .filter((issue) => issue !== undefined && !issue.deleted)
      .map((issue) => issueSearchPayload(issue, requestedFields));
    return send(res, 200, { issues: found, isLast: true });
  }

  // Deletion-confirm primitive: GET /rest/api/3/issue/{id}. Only a genuine 404
  // means "gone" — the app requires two consecutive confirmed ticks before acting.
  const singleIssueMatch = /^\/rest\/api\/3\/issue\/(\d+)$/.exec(pathname);
  if (method === 'GET' && singleIssueMatch) {
    if (!isAuthorized(req)) return send(res, 401, { errorMessages: ['Unauthorized'] });
    const issue = issues.get(singleIssueMatch[1]);
    if (!issue || issue.deleted) return send(res, 404, { errorMessages: ['Issue does not exist'] });
    return send(res, 200, issuePayload(issue));
  }

  // Connection test: GET /rest/api/3/myself.
  if (method === 'GET' && pathname === '/rest/api/3/myself') {
    if (!isAuthorized(req)) return send(res, 401, { errorMessages: ['Unauthorized'] });
    return send(res, 200, {
      accountId: 'mock-jira-account',
      displayName: 'Mock Jira Bot',
      emailAddress: expectedEmail,
    });
  }

  // Project picker: GET /rest/api/3/project/search. A small fixed catalog is
  // enough for the admin/department pickers to exercise a real, non-empty load.
  if (method === 'GET' && pathname === '/rest/api/3/project/search') {
    if (!isAuthorized(req)) return send(res, 401, { errorMessages: ['Unauthorized'] });
    return send(res, 200, {
      isLast: true,
      values: [
        { id: '10001', key: 'OPS', name: 'Operations' },
        { id: '10002', key: 'MKT', name: 'Marketing Ops' },
      ],
    });
  }

  // Stand-in landing page for the tab the SPA opens via window.open on the browse
  // URL. Not part of the real Jira API surface — just keeps the popped-up tab from
  // showing a bare 404 JSON body.
  const browseMatch = /^\/browse\/(.+)$/.exec(pathname);
  if (method === 'GET' && browseMatch) {
    const html = `<!doctype html><html><body><h1>Mock Jira issue ${decodeURIComponent(browseMatch[1])}</h1></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': Buffer.byteLength(html) });
    return res.end(html);
  }

  // --- __test__ control routes (unauthenticated — test-only) ---------------------

  // Script a status transition: { id?, key?, statusName, categoryKey, resolution?, assignee? }.
  if (method === 'POST' && pathname === '/__test__/transition') {
    const issue = findIssue(body?.id ?? body?.key);
    if (!issue) return send(res, 404, { error: 'unknown issue' });
    if (typeof body?.statusName === 'string') issue.statusName = body.statusName;
    if (typeof body?.categoryKey === 'string') issue.categoryKey = body.categoryKey;
    if (body !== null && 'resolution' in body) issue.resolution = body.resolution ?? null;
    if (body !== null && 'assignee' in body) issue.assignee = body.assignee ?? null;
    return send(res, 200, { ok: true, issue: issuePayload(issue) });
  }

  // Mark an issue deleted (id or key): POST /__test__/delete/:idOrKey.
  const deleteMatch = /^\/__test__\/delete\/(.+)$/.exec(pathname);
  if (method === 'POST' && deleteMatch) {
    const issue = findIssue(decodeURIComponent(deleteMatch[1]));
    if (!issue) return send(res, 404, { error: 'unknown issue' });
    issue.deleted = true;
    return send(res, 200, { ok: true });
  }

  // Full reset: clears every issue and both counters.
  if (method === 'POST' && pathname === '/__test__/reset') {
    resetState();
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { errorMessages: ['Unknown mock-jira endpoint'] });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('[mock-jira] handler error:', err);
    send(res, 500, { errorMessages: ['mock-jira internal error'] });
  });
});

server.listen(port, () => {
  console.log(`[mock-jira] ready at http://localhost:${port}`);
  console.log(`[mock-jira] asserting Basic auth for ${expectedEmail}`);
});

async function shutdown() {
  try {
    await new Promise((resolve) => server.close(() => resolve()));
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
