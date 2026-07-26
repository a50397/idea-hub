import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useMailSettingsStore } from '../stores/mailSettings';
import type { MailSettings } from '../types';

// Replace the real network layer; the store must never hit axios.
vi.mock('../api/mailSettings', () => ({
  mailSettingsApi: {
    get: vi.fn(),
    update: vi.fn(),
    sendTest: vi.fn(),
  },
}));

import { mailSettingsApi } from '../api/mailSettings';
const mockedApi = vi.mocked(mailSettingsApi);

function masked(overrides: Partial<MailSettings> = {}): MailSettings {
  return {
    enabled: false,
    host: '',
    port: 587,
    secure: false,
    username: '',
    from: 'IdeaHub <no-reply@ideahub.local>',
    language: 'en',
    subjectTemplate: '',
    hasPassword: false,
    ...overrides,
  };
}

describe('mailSettings store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('fetch', () => {
    it('loads the masked settings and clears error', async () => {
      mockedApi.get.mockResolvedValueOnce(masked({ enabled: true, host: 'smtp.corp.example', hasPassword: true }));
      const store = useMailSettingsStore();

      const ok = await store.fetch();

      expect(ok).toBe(true);
      expect(mockedApi.get).toHaveBeenCalledTimes(1);
      expect(store.settings?.host).toBe('smtp.corp.example');
      expect(store.settings?.hasPassword).toBe(true);
      expect(store.error).toBeNull();
      expect(store.loading).toBe(false);
    });

    it('captures the server error message on failure', async () => {
      mockedApi.get.mockRejectedValueOnce({ response: { data: { error: 'boom' } } });
      const store = useMailSettingsStore();

      const ok = await store.fetch();

      expect(ok).toBe(false);
      expect(store.error).toBe('boom');
    });

    it('falls back to a generic message when the server sends none', async () => {
      mockedApi.get.mockRejectedValueOnce(new Error('network down'));
      const store = useMailSettingsStore();

      const ok = await store.fetch();

      expect(ok).toBe(false);
      expect(store.error).toBe('Failed to load mail settings');
    });
  });

  describe('save', () => {
    it('forwards the payload and stores the masked response', async () => {
      mockedApi.update.mockResolvedValueOnce(masked({ host: 'smtp.corp.example', hasPassword: true }));
      const store = useMailSettingsStore();

      const ok = await store.save({
        enabled: true,
        host: 'smtp.corp.example',
        port: 2525,
        secure: false,
        username: 'relay-user',
        password: 'new-secret',
        from: 'IdeaHub <no-reply@ideahub.local>',
        language: 'en',
        subjectTemplate: '',
      });

      expect(ok).toBe(true);
      expect(mockedApi.update).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'smtp.corp.example', password: 'new-secret' })
      );
      expect(store.settings?.hasPassword).toBe(true);
    });

    it('captures a 400 (enabled requires host) error', async () => {
      mockedApi.update.mockRejectedValueOnce({
        response: { data: { error: 'An SMTP host is required when outbound email is enabled' } },
      });
      const store = useMailSettingsStore();

      const ok = await store.save({
        enabled: true,
        host: '',
        port: 587,
        secure: false,
        username: '',
        from: 'IdeaHub <no-reply@ideahub.local>',
        language: 'en',
        subjectTemplate: '',
      });

      expect(ok).toBe(false);
      expect(store.error).toBe('An SMTP host is required when outbound email is enabled');
    });
  });

  describe('sendTest', () => {
    it('returns the { ok } result on success', async () => {
      mockedApi.sendTest.mockResolvedValueOnce({ ok: true });
      const store = useMailSettingsStore();

      const result = await store.sendTest('admin@corp.example');

      expect(result).toEqual({ ok: true });
      expect(mockedApi.sendTest).toHaveBeenCalledWith('admin@corp.example');
      expect(store.testing).toBe(false);
    });

    it('passes through a best-effort ok:false result', async () => {
      mockedApi.sendTest.mockResolvedValueOnce({ ok: false });
      const store = useMailSettingsStore();

      const result = await store.sendTest('admin@corp.example');

      expect(result).toEqual({ ok: false });
    });

    it('returns null and captures the error when the request itself fails', async () => {
      mockedApi.sendTest.mockRejectedValueOnce({ response: { data: { error: 'nope' } } });
      const store = useMailSettingsStore();

      const result = await store.sendTest('admin@corp.example');

      expect(result).toBeNull();
      expect(store.error).toBe('nope');
    });
  });
});
