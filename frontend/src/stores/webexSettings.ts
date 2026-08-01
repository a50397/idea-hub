import { defineStore } from 'pinia';
import { ref } from 'vue';
import { webexSettingsApi, type WebexSettingsUpdate, type WebexTestResult } from '../api/webexSettings';
import type { WebexSettings } from '../types';

export const useWebexSettingsStore = defineStore('webexSettings', () => {
  const settings = ref<WebexSettings | null>(null);
  const loading = ref(false);
  const saving = ref(false);
  const testing = ref(false);
  const error = ref<string | null>(null);

  async function fetch() {
    loading.value = true;
    error.value = null;
    try {
      settings.value = await webexSettingsApi.get();
      return true;
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to load webex settings';
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function save(payload: WebexSettingsUpdate) {
    saving.value = true;
    error.value = null;
    try {
      settings.value = await webexSettingsApi.update(payload);
      return true;
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to save webex settings';
      return false;
    } finally {
      saving.value = false;
    }
  }

  // Returns the structured WebexTestResult on success, or null when the request
  // itself failed (network/validation/authz) — distinct from a delivered result
  // whose own `ok` may be false.
  async function sendTest(to: string): Promise<WebexTestResult | null> {
    testing.value = true;
    error.value = null;
    try {
      return await webexSettingsApi.sendTest(to);
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to send test message';
      return null;
    } finally {
      testing.value = false;
    }
  }

  return { settings, loading, saving, testing, error, fetch, save, sendTest };
});
