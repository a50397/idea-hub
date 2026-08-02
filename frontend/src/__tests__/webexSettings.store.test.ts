import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useWebexSettingsStore } from '../stores/webexSettings';
import type { WebexSettings } from '../types';

// Replace the real network layer; the store must never hit axios.
vi.mock('../api/webexSettings', () => ({
  webexSettingsApi: {
    get: vi.fn(),
    update: vi.fn(),
    sendTest: vi.fn(),
  },
}));

import { webexSettingsApi } from '../api/webexSettings';
const mockedApi = vi.mocked(webexSettingsApi);

function masked(overrides: Partial<WebexSettings> = {}): WebexSettings {
  return {
    enabled: false,
    language: 'sk',
    hasToken: false,
    ...overrides,
  };
}

describe('webexSettings store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('fetch', () => {
    it('loads the masked settings and clears error', async () => {
      mockedApi.get.mockResolvedValueOnce(masked({ enabled: true, hasToken: true, language: 'en' }));
      const store = useWebexSettingsStore();

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
      const store = useWebexSettingsStore();

      const ok = await store.fetch();

      expect(ok).toBe(false);
      expect(store.error).toBe('boom');
    });

    it('falls back to a generic message when the server sends none', async () => {
      mockedApi.get.mockRejectedValueOnce(new Error('network down'));
      const store = useWebexSettingsStore();

      const ok = await store.fetch();

      expect(ok).toBe(false);
      expect(store.error).toBe('Failed to load webex settings');
    });
  });

  describe('save', () => {
    it('forwards the payload and stores the masked response', async () => {
      mockedApi.update.mockResolvedValueOnce(masked({ enabled: true, hasToken: true }));
      const store = useWebexSettingsStore();

      const ok = await store.save({ enabled: true, language: 'en', token: 'new-token' });

      expect(ok).toBe(true);
      expect(mockedApi.update).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true, token: 'new-token' })
      );
      expect(store.settings?.hasToken).toBe(true);
    });

    it('captures a server error on save failure', async () => {
      mockedApi.update.mockRejectedValueOnce({
        response: { data: { error: 'Token must be at most 512 characters' } },
      });
      const store = useWebexSettingsStore();

      const ok = await store.save({ enabled: true, language: 'sk', token: 'x'.repeat(600) });

      expect(ok).toBe(false);
      expect(store.error).toBe('Token must be at most 512 characters');
    });
  });

  describe('sendTest', () => {
    it('returns the structured result on a successful send', async () => {
      mockedApi.sendTest.mockResolvedValueOnce({ ok: true });
      const store = useWebexSettingsStore();

      const result = await store.sendTest('admin@corp.example');

      expect(result).toEqual({ ok: true });
      expect(mockedApi.sendTest).toHaveBeenCalledWith('admin@corp.example');
      expect(store.testing).toBe(false);
    });

    it('passes a failed result (with its fixed reason) straight through', async () => {
      mockedApi.sendTest.mockResolvedValueOnce({ ok: false, reason: 'recipient_not_found' });
      const store = useWebexSettingsStore();

      const result = await store.sendTest('admin@corp.example');

      expect(result).toEqual({ ok: false, reason: 'recipient_not_found' });
    });

    it('returns null and captures the error when the request itself fails', async () => {
      mockedApi.sendTest.mockRejectedValueOnce({ response: { data: { error: 'nope' } } });
      const store = useWebexSettingsStore();

      const result = await store.sendTest('admin@corp.example');

      expect(result).toBeNull();
      expect(store.error).toBe('nope');
    });
  });
});
