import client from './client';
import type { MailSettings } from '../types';

// The PUT payload. `password` is WRITE-ONLY and OPTIONAL: include it (non-empty)
// to set a new password; omit it to keep the stored one; the server wipes the
// stored password when `username` is saved empty.
export interface MailSettingsUpdate {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password?: string;
  from: string;
  language: 'en' | 'sk';
  subjectTemplate: string;
}

// Structured outcome of the ADMIN diagnostic test-send. Mirrors the backend
// MailTestResult union (backend/src/utils/mailer.ts). A 'failed' result carries a
// FIXED reason CATEGORY — never any server- or config-derived text — so no SMTP
// secret can travel back through it. The UI translates the reason to a friendly
// message (i18n key mailSettings.testReason.<reason>).
export type MailFailureReason =
  | 'connection_refused'
  | 'auth_failed'
  | 'timeout'
  | 'host_not_found'
  | 'tls_error'
  | 'config_error'
  | 'unknown';

export type MailTestResult =
  | { status: 'sent' }
  | { status: 'disabled' }
  | { status: 'failed'; reason: MailFailureReason };

export const mailSettingsApi = {
  get: async (): Promise<MailSettings> => {
    const response = await client.get('/mail-settings');
    return response.data;
  },

  update: async (payload: MailSettingsUpdate): Promise<MailSettings> => {
    const response = await client.put('/mail-settings', payload);
    return response.data;
  },

  // Diagnostic test send using the SAVED settings. Always resolves 200 with a
  // structured MailTestResult: 'sent' | 'disabled' | 'failed' (+ a fixed reason
  // category). The reason NEVER contains any secret-bearing text.
  sendTest: async (to: string): Promise<MailTestResult> => {
    const response = await client.post('/mail-settings/test', { to });
    return response.data;
  },
};
