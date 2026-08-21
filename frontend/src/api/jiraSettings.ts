import client from './client';
import type { JiraSettings, JiraFailureReason, JiraProject } from '../types';

// The PUT payload. `apiToken` is WRITE-ONLY and OPTIONAL and drives keep/set/wipe of
// the stored API token (the Jira analogue of the mail password / Webex bot token):
// OMIT it to keep the stored token, include a NON-EMPTY value to set a new one, and
// include an EMPTY STRING to wipe it. NOTE (security review F2 — no Webex/mail
// counterpart): the backend REJECTS a save that changes `baseUrl` or `email` while a
// token is already stored unless this save ALSO sets or wipes the token (400) — see
// JiraSettingsPage's identity-change hint.
export interface JiraSettingsUpdate {
  enabled: boolean;
  baseUrl: string;
  email: string;
  defaultProjectKey: string;
  issueTypeName: string;
  pollIntervalMinutes: number;
  cancelResolutions: string;
  apiToken?: string;
}

// Structured outcome of the ADMIN diagnostic test (GET /rest/api/3/myself with the
// SAVED settings). Mirrors WebexTestResult: `{ ok }` / `{ ok, reason }`. An
// `ok: false` result carries a FIXED reason CATEGORY — never any config- or
// error-derived text — so no credential can travel back through it. The UI
// translates the reason to a friendly message (i18n key jiraSettings.testReason.<reason>).
export type JiraTestResult = { ok: true } | { ok: false; reason: JiraFailureReason };

// The /projects response. The endpoint ALWAYS answers 200: on success `projects` is
// the listing and `reason` is absent; on ANY failure (Jira disabled, unreachable,
// credentials rejected) `projects` is [] and `reason` is a FIXED JiraFailureReason
// category. So the admin (and the departments) picker can render when projects load
// yet always fall back to manual key entry. The API token is NEVER part of this shape.
export interface JiraProjectsResponse {
  projects: JiraProject[];
  reason?: JiraFailureReason;
}

export const jiraSettingsApi = {
  get: async (): Promise<JiraSettings> => {
    const response = await client.get('/jira-settings');
    return response.data;
  },

  update: async (payload: JiraSettingsUpdate): Promise<JiraSettings> => {
    const response = await client.put('/jira-settings', payload);
    return response.data;
  },

  // Diagnostic test using the SAVED settings (no request body — unlike the
  // mail/Webex test sends there is no recipient to name). Always resolves 200 with a
  // structured JiraTestResult: `{ ok: true }` or `{ ok: false, reason }`.
  test: async (): Promise<JiraTestResult> => {
    const response = await client.post('/jira-settings/test');
    return response.data;
  },

  // List the Jira projects the configured tech user can see, powering the default-
  // project picker here and the per-department override picker on DepartmentsPage.
  // Always resolves 200 with { projects } (success) or { projects: [], reason }
  // (failure); the caller renders the picker when projects load and always also
  // allows manual key entry. NEVER returns the API token.
  getProjects: async (): Promise<JiraProjectsResponse> => {
    const response = await client.get('/jira-settings/projects');
    return response.data;
  },
};
