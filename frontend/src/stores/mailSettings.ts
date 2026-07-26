import { defineStore } from 'pinia';
import { ref } from 'vue';
import { mailSettingsApi, type MailSettingsUpdate } from '../api/mailSettings';
import type { MailSettings } from '../types';

export const useMailSettingsStore = defineStore('mailSettings', () => {
  const settings = ref<MailSettings | null>(null);
  const loading = ref(false);
  const saving = ref(false);
  const testing = ref(false);
  const error = ref<string | null>(null);

  async function fetch() {
    loading.value = true;
    error.value = null;
    try {
      settings.value = await mailSettingsApi.get();
      return true;
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to load mail settings';
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function save(payload: MailSettingsUpdate) {
    saving.value = true;
    error.value = null;
    try {
      settings.value = await mailSettingsApi.update(payload);
      return true;
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to save mail settings';
      return false;
    } finally {
      saving.value = false;
    }
  }

  // Returns the { ok } result on success, or null when the request itself failed
  // (network/validation/authz) — distinct from a delivered-but-failed ok:false.
  async function sendTest(to: string): Promise<{ ok: boolean } | null> {
    testing.value = true;
    error.value = null;
    try {
      return await mailSettingsApi.sendTest(to);
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to send test email';
      return null;
    } finally {
      testing.value = false;
    }
  }

  return { settings, loading, saving, testing, error, fetch, save, sendTest };
});
