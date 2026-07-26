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

export const mailSettingsApi = {
  get: async (): Promise<MailSettings> => {
    const response = await client.get('/mail-settings');
    return response.data;
  },

  update: async (payload: MailSettingsUpdate): Promise<MailSettings> => {
    const response = await client.put('/mail-settings', payload);
    return response.data;
  },

  // Best-effort test send using the SAVED settings. Always resolves 200 with a
  // boolean; `ok:false` means "not delivered" (dead relay, disabled, etc.).
  sendTest: async (to: string): Promise<{ ok: boolean }> => {
    const response = await client.post('/mail-settings/test', { to });
    return response.data;
  },
};
