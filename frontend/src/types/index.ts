export enum Role {
  USER = 'USER',
  POWER_USER = 'POWER_USER',
  ADMIN = 'ADMIN',
}

export enum IdeaStatus {
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
  REJECTED = 'REJECTED',
}

export enum Effort {
  LESS_THAN_ONE_DAY = 'LESS_THAN_ONE_DAY',
  ONE_TO_THREE_DAYS = 'ONE_TO_THREE_DAYS',
  MORE_THAN_THREE_DAYS = 'MORE_THAN_THREE_DAYS',
}

export enum EventType {
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CLAIMED = 'CLAIMED',
  STARTED = 'STARTED',
  COMPLETED = 'COMPLETED',
  UPDATED = 'UPDATED',
  CHANGE_REQUESTED = 'CHANGE_REQUESTED',
  // A POWER_USER/ADMIN dispatched the idea to Jira (POST /api/ideas/:id/jira-task).
  // Always carries a user actor (byUserId non-null).
  JIRA_CREATED = 'JIRA_CREATED',
  // The poller (backend) mirrored a Jira status change onto the idea. NO user actor
  // — byUserId/byUser are always null (see IdeaEvent below).
  JIRA_STATUS_CHANGED = 'JIRA_STATUS_CHANGED',
  // The Jira issue reached an unsuccessful final state (cancel-list resolution) or
  // is gone (deleted/no longer accessible) — the idea returns to APPROVED. No user
  // actor — byUserId/byUser are always null.
  JIRA_CANCELLED = 'JIRA_CANCELLED',
}

// status.statusCategory.key from Jira, mirrored onto Idea.jiraStatusCategory. Drives
// the canonical IdeaStatus on the backend and the chip color on the frontend.
export type JiraStatusCategory = 'new' | 'indeterminate' | 'done';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  authProvider?: 'LOCAL' | 'SSO' | null;
  department?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface UserWithCounts extends User {
  _count?: {
    submittedIdeas: number;
    approvedIdeas: number;
    assignedIdeas: number;
  };
}

// The PUBLIC pre-login config (GET /api/auth/config). It carries ONLY what the
// login page needs: whether to show the SSO button. Every session-scoped flag
// (including the SSO logout-button visibility) lives on AppOptions instead.
export interface AuthConfig {
  ssoEnabled: boolean;
}

// Consolidated FE-facing runtime flags for the authenticated app (GET /api/options).
// Every session-scoped UI flag — DB-derived (mailEnabled, webexEnabled) or
// env-derived (ssoShowLogout) — lives here rather than on the public AuthConfig.
export interface AppOptions {
  // Whether outbound mail is effectively enabled. Together with webexEnabled this
  // drives the per-idea notify toggle (shown when EITHER channel is enabled).
  mailEnabled: boolean;
  // Whether the Webex notification channel is effectively enabled (enabled AND a
  // usable bot token). The second channel behind the per-idea notify toggle.
  webexEnabled: boolean;
  // Whether the Jira execution channel is effectively enabled (enabled AND a usable
  // base URL/account email/API token). Gates the "Create Jira task" button — a
  // third, independent flag (NOT part of notifyOnChange's mail-or-webex toggle).
  jiraEnabled: boolean;
  // Whether to re-expose the in-app logout button for SSO users (SSO_SHOW_LOGOUT).
  ssoShowLogout: boolean;
  // Whether the Jira BACKGROUND POLLER is currently failing — drives the admin
  // warning banner in MainLayout.
  //
  // OPTIONAL because the server sends it ONLY to an ADMIN session: for every other
  // role the key is absent, not false (routes/options.ts documents that role-gated
  // exception). Consumers must therefore treat "absent" as "not failing" — the
  // options store's `?? false` — and never as "unknown".
  jiraSyncFailing?: boolean;
}

export interface Department {
  id: string;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  // Admin-managed notification recipients. Present ONLY in ADMIN responses; the
  // backend omits it entirely for non-admin sessions, hence optional.
  notificationEmails?: string[];
  // Admin-managed Webex space (room) ids that new-idea notifications are posted to.
  // Like notificationEmails, present ONLY in ADMIN responses (the backend omits it
  // for non-admin sessions), hence optional.
  webexRoomIds?: string[];
  // Optional per-department Jira project-key override (installation-wide default
  // lives on JiraSettings). Like the two fields above, present ONLY in ADMIN
  // responses; null/absent means "no override — use the installation default".
  jiraProjectKey?: string | null;
  _count?: {
    ideas: number;
  };
}

// Admin-managed outbound mail configuration. This is the MASKED shape returned by
// the API: the SMTP password is NEVER included — only `hasPassword` indicates
// whether one is stored. The password is write-only (sent on save, never read).
export interface MailSettings {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  from: string;
  language: 'en' | 'sk';
  subjectTemplate: string;
  hasPassword: boolean;
}

// Admin-managed Webex notification configuration. This is the MASKED shape
// returned by the API: the bot token is NEVER included — only `hasToken` indicates
// whether one is stored. The token is write-only (sent on save, never read).
export interface WebexSettings {
  enabled: boolean;
  language: 'en' | 'sk';
  hasToken: boolean;
}

// Fixed failure categories the Jira client (backend) collapses every outbound
// failure to — NEVER free-form upstream text (security review F9). Shared by the
// settings test button, the projects picker and the jira-task dispatch 502.
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

// The last outcome of the Jira background poller, as reported by
// GET /api/jira-settings. READ-ONLY status: the poller writes it, a settings save
// never touches it.
//
// `at` is when this state was ENTERED, not the time of the last attempt — the
// backend records on transition only — so a failing record reads as "failing SINCE
// at". `reason` is one of the closed JiraFailureReason codes (absent while healthy)
// and is rendered through the existing jiraSettings.testReason.* catalog.
export interface JiraSyncStatus {
  ok: boolean;
  reason?: JiraFailureReason;
  at: string;
}

// Admin-managed Jira integration configuration. This is the MASKED shape returned
// by the API: the API token is NEVER included — only `hasToken` indicates whether
// one is stored. The token is write-only (sent on save, never read).
export interface JiraSettings {
  enabled: boolean;
  baseUrl: string;
  email: string;
  defaultProjectKey: string;
  issueTypeName: string;
  pollIntervalMinutes: number;
  cancelResolutions: string;
  hasToken: boolean;
  // The poller's health record; null when it has never recorded an outcome (a
  // freshly configured installation). Optional so every consumer stays null-safe —
  // the settings page reads it as `settings.lastSync?.ok === false`, which is
  // equally correct for a response that predates the field.
  lastSync?: JiraSyncStatus | null;
}

// A Jira project the configured tech user can see, as returned by
// GET /api/jira-settings/projects. Powers the default-project picker (settings
// page) and the per-department override picker (departments page).
export interface JiraProject {
  key: string;
  name: string;
}

// One row of GET /api/reports/jira-statuses: a raw Jira status name and how many
// dispatched ideas currently carry it. Pre-sorted desc by count on the backend.
export interface JiraStatusReport {
  status: string;
  count: number;
}

export interface LogoutResponse {
  message: string;
  // Present only for SSO sessions: the IdP end-session (RP-initiated logout)
  // URL the browser should be sent to so the IdP session is also terminated.
  redirectTo?: string;
}

export interface Idea {
  id: string;
  title: string;
  description: string;
  benefits: string;
  effort: Effort;
  status: IdeaStatus;
  tags: string[];
  departmentId?: string | null;
  department?: { id: string; name: string } | null;
  submitterId: string;
  submitter: User;
  approverId?: string;
  approver?: User;
  assigneeId?: string;
  assignee?: User;
  // Submitter's opt-in to lifecycle notification emails. Nullable: legacy docs
  // created before the field existed read back as null, which every consumer
  // treats as false (opted out).
  notifyOnChange?: boolean | null;
  submittedAt: string;
  approvedAt?: string;
  startedAt?: string;
  completedAt?: string;
  rejectedAt?: string;
  createdAt: string;
  updatedAt: string;
  events?: IdeaEvent[];
  steps?: IdeaStep[];
  // Jira execution mirror (backend prisma/schema.prisma Idea model). All
  // optional/nullable: absent/null on an idea that has never been dispatched to
  // Jira, and null-safe on any document that predates the feature (the
  // missing-vs-null rule — every read path treats a missing field as null).
  jiraIssueId?: string | null;
  jiraIssueKey?: string | null;
  // Raw Jira status NAME (e.g. "In Review"); jiraStatusCategory is the
  // new/indeterminate/done bucket that drives `status` above.
  jiraStatus?: string | null;
  jiraStatusCategory?: JiraStatusCategory | null;
  jiraAssignee?: string | null;
  jiraResolution?: string | null;
  // Dispatch-claim + poll-enrolment flag: true while the idea is enrolled in the
  // Jira poller (from the moment "Create Jira task" succeeds until a final state).
  jiraSyncActive?: boolean | null;
  jiraLastSyncAt?: string | null;
  jiraMissingCount?: number | null;
  // Server-built browse link (`{baseUrl}/browse/{key}`). OMITTED entirely — never
  // null — when it cannot be built safely (security review F7); present on list
  // items, the detail GET and the jira-task dispatch response whenever it can be.
  // NEVER build this URL client-side — always use the server-provided value.
  jiraBrowseUrl?: string;
}

export interface IdeaStep {
  id: string;
  ideaId: string;
  text: string;
  createdAt: string;
}

export interface IdeaEvent {
  id: string;
  ideaId: string;
  type: EventType;
  // NULL for poller-written events (JIRA_STATUS_CHANGED / JIRA_CANCELLED — Jira
  // itself is the actor, with no logged-in user behind the change); every other
  // event type (including JIRA_CREATED) always carries a user. Renderers MUST
  // null-guard (see events.actorJira / eventTypeKeyMap for the timeline label).
  byUserId: string | null;
  byUser: User | null;
  timestamp: string;
  note?: string;
}

export interface CreateIdeaInput {
  title: string;
  description: string;
  benefits: string;
  effort: Effort;
  departmentId: string;
  tags?: string[];
  // Opt-in to lifecycle notification emails, only sent when mail is enabled.
  notifyOnChange?: boolean;
}

export interface UpdateIdeaInput {
  title?: string;
  description?: string;
  benefits?: string;
  effort?: Effort;
  departmentId?: string;
  tags?: string[];
}

export interface ReviewIdeaInput {
  note?: string;
}

// Envelope returned by the paginated list endpoints (GET /api/ideas,
// GET /api/reports/filtered). `total` is the full match count, independent of
// the `limit` that capped `data`; list views page through it via `totalPages`,
// and the CSV export uses it to flag a capped download.
// Hard cap the server puts on `limit` for both paginated endpoints
// (backend/src/utils/validation.ts, paginationSchema). Requesting more is a
// 400, so this is also the largest page the UI can ever show or export.
export const MAX_PAGE_LIMIT = 100;

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: Pagination;
}

export interface DashboardSummary {
  counts: {
    submitted: number;
    approved: number;
    inProgress: number;
    done: number;
    rejected: number;
    total: number;
  };
  averageTimes: {
    submittedToApprovedDays: number;
    approvedToDoneDays: number;
  };
}

export interface MonthlyTrend {
  month: string;
  count: number;
}

export interface TopContributor {
  userId: string;
  userName: string;
  userEmail: string;
  completedIdeas: number;
}

// Note the field names differ from Department: the backend by-department report
// returns { departmentId, name, count } (zero-filled, sorted by order).
export interface DepartmentReport {
  departmentId: string;
  name: string;
  count: number;
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role?: Role;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  password?: string;
  role?: Role;
}

export const effortLabels: Record<Effort, string> = {
  [Effort.LESS_THAN_ONE_DAY]: '< 1 day',
  [Effort.ONE_TO_THREE_DAYS]: '1-3 days',
  [Effort.MORE_THAN_THREE_DAYS]: '> 3 days',
};

export const statusLabels: Record<IdeaStatus, string> = {
  [IdeaStatus.SUBMITTED]: 'Submitted',
  [IdeaStatus.APPROVED]: 'Approved',
  [IdeaStatus.IN_PROGRESS]: 'In Progress',
  [IdeaStatus.DONE]: 'Done',
  [IdeaStatus.REJECTED]: 'Rejected',
};

export const statusColors: Record<IdeaStatus, string> = {
  [IdeaStatus.SUBMITTED]: 'info',
  [IdeaStatus.APPROVED]: 'success',
  [IdeaStatus.IN_PROGRESS]: 'warning',
  [IdeaStatus.DONE]: 'primary',
  [IdeaStatus.REJECTED]: 'error',
};

// Maps every EventType to its `events.<key>` i18n label key (IdeaDetailPage
// timeline). Deliberately exhaustive over ALL 11 event kinds — including the ones
// no route creates anymore (CLAIMED/STARTED/CHANGE_REQUESTED) — because historical
// documents can still carry them and the timeline must never show an untranslated
// raw enum value for old data.
export const eventTypeKeyMap: Record<EventType, string> = {
  [EventType.SUBMITTED]: 'submitted',
  [EventType.APPROVED]: 'approved',
  [EventType.REJECTED]: 'rejected',
  [EventType.CLAIMED]: 'claimed',
  [EventType.STARTED]: 'started',
  [EventType.COMPLETED]: 'completed',
  [EventType.UPDATED]: 'updated',
  [EventType.CHANGE_REQUESTED]: 'changeRequested',
  [EventType.JIRA_CREATED]: 'jiraCreated',
  [EventType.JIRA_STATUS_CHANGED]: 'jiraStatusChanged',
  [EventType.JIRA_CANCELLED]: 'jiraCancelled',
};

// Chip color per Jira status category — shared by IdeaCard, IdeaDetailPage's Jira
// sidebar block and anywhere else a raw Jira status is shown.
export const jiraCategoryColors: Record<JiraStatusCategory, string> = {
  new: 'info',
  indeterminate: 'warning',
  done: 'success',
};
