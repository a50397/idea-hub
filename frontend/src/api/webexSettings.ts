import client from './client';
import type { WebexSettings } from '../types';

// The PUT payload. `token` is WRITE-ONLY and OPTIONAL and drives keep/set/wipe of
// the stored bot token (the Webex analogue of the mail password): OMIT it to keep
// the stored token, include a NON-EMPTY value to set a new one, and include an
// EMPTY STRING to wipe it. (Unlike mail there is no username to key the wipe off,
// so the empty-string token is itself the wipe signal.)
export interface WebexSettingsUpdate {
  enabled: boolean;
  language: 'en' | 'sk';
  token?: string;
}

// Structured outcome of the ADMIN diagnostic test-send. Mirrors the backend
// WebexTestResult union (backend/src/utils/webex.ts). NOTE: the shape differs from
// the mail test result — it is `{ ok }` / `{ ok, reason }` rather than `{ status }`.
// An `ok: false` result carries a FIXED reason CATEGORY — never any config- or
// error-derived text — so no bot token can travel back through it. The UI
// translates the reason to a friendly message (i18n key webexSettings.testReason.<reason>).
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

export type WebexTestResult = { ok: true } | { ok: false; reason: WebexFailureReason };

export const webexSettingsApi = {
  get: async (): Promise<WebexSettings> => {
    const response = await client.get('/webex-settings');
    return response.data;
  },

  update: async (payload: WebexSettingsUpdate): Promise<WebexSettings> => {
    const response = await client.put('/webex-settings', payload);
    return response.data;
  },

  // Diagnostic test send using the SAVED settings. Always resolves 200 with a
  // structured WebexTestResult: `{ ok: true }` or `{ ok: false, reason }` (a fixed
  // reason category). The reason NEVER contains any secret-bearing text.
  sendTest: async (to: string): Promise<WebexTestResult> => {
    const response = await client.post('/webex-settings/test', { to });
    return response.data;
  },
};
