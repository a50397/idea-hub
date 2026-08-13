import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useJiraSettingsStore } from '../stores/jiraSettings';
import type { JiraSettings } from '../types';

// Replace the real network layer; the store must never hit axios.
vi.mock('../api/jiraSettings', () => ({
  jiraSettingsApi: {
    get: vi.fn(),
    update: vi.fn(),
    test: vi.fn(),
    getProjects: vi.fn(),
  },
}));

import { jiraSettingsApi } from '../api/jiraSettings';
const mockedApi = vi.mocked(jiraSettingsApi);

function masked(overrides: Partial<JiraSettings> = {}): JiraSettings {
  return {
    enabled: false,
    baseUrl: '',
    email: '',
    defaultProjectKey: '',
    issueTypeName: 'Task',
    pollIntervalMinutes: 5,
    cancelResolutions: "Won't Do,Cancelled,Duplicate",
    hasToken: false,
    ...overrides,
  };
}

describe('jiraSettings store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('fetch', () => {
    it('loads the masked settings and clears error', async () => {
      mockedApi.get.mockResolvedValueOnce(masked({ enabled: true, hasToken: true, baseUrl: 'https://acme.atlassian.net' }));
      const store = useJiraSettingsStore();

      const ok = await store.fetch();

      expect(ok).toBe(true);
      expect(mockedApi.get).toHaveBeenCalledTimes(1);
      expect(store.settings?.enabled).toBe(true);
      expect(store.settings?.hasToken).toBe(true);
      expect(store.error).toBeNull();
      expect(store.loading).toBe(false);
    });

    it('captures the server error message on failure', async () => {
      mockedApi.get.mockRejectedValueOnce({ response: { data: { error: 'boom' } } });
      const store = useJiraSettingsStore();

      const ok = await store.fetch();

      expect(ok).toBe(false);
      expect(store.error).toBe('boom');
    });

    it('falls back to a generic message when the server sends none', async () => {
      mockedApi.get.mockRejectedValueOnce(new Error('network down'));
      const store = useJiraSettingsStore();

      const ok = await store.fetch();

      expect(ok).toBe(false);
      expect(store.error).toBe('Failed to load jira settings');
    });
  });

  describe('save', () => {
    it('forwards the payload and stores the masked response', async () => {
      mockedApi.update.mockResolvedValueOnce(masked({ enabled: true, hasToken: true }));
      const store = useJiraSettingsStore();

      const ok = await store.save({
        enabled: true,
        baseUrl: 'https://acme.atlassian.net',
        email: 'tech@corp.example',
        defaultProjectKey: 'OPS',
        issueTypeName: 'Task',
        pollIntervalMinutes: 5,
        cancelResolutions: "Won't Do",
        apiToken: 'new-token',
      });

      expect(ok).toBe(true);
      expect(mockedApi.update).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true, apiToken: 'new-token' })
      );
      expect(store.settings?.hasToken).toBe(true);
    });

    it('captures a server error on save failure', async () => {
      mockedApi.update.mockRejectedValueOnce({
        response: { data: { error: 'Changing the Jira base URL or account email requires re-entering the API token (or clearing it).' } },
      });
      const store = useJiraSettingsStore();

      const ok = await store.save({
        enabled: true,
        baseUrl: 'https://evil.example',
        email: 'tech@corp.example',
        defaultProjectKey: '',
        issueTypeName: 'Task',
        pollIntervalMinutes: 5,
        cancelResolutions: '',
      });

      expect(ok).toBe(false);
      expect(store.error).toMatch(/re-entering the API token/i);
    });
  });

  describe('test', () => {
    it('returns the structured result on a successful test', async () => {
      mockedApi.test.mockResolvedValueOnce({ ok: true });
      const store = useJiraSettingsStore();

      const result = await store.test();

      expect(result).toEqual({ ok: true });
      expect(mockedApi.test).toHaveBeenCalledTimes(1);
      expect(store.testing).toBe(false);
    });

    it('passes a failed result (with its fixed reason) straight through', async () => {
      mockedApi.test.mockResolvedValueOnce({ ok: false, reason: 'invalid_credentials' });
      const store = useJiraSettingsStore();

      const result = await store.test();

      expect(result).toEqual({ ok: false, reason: 'invalid_credentials' });
    });

    it('returns null and captures the error when the request itself fails', async () => {
      mockedApi.test.mockRejectedValueOnce({ response: { data: { error: 'nope' } } });
      const store = useJiraSettingsStore();

      const result = await store.test();

      expect(result).toBeNull();
      expect(store.error).toBe('nope');
    });
  });
});
