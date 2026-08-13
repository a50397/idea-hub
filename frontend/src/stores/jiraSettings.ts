import { defineStore } from 'pinia';
import { ref } from 'vue';
import { jiraSettingsApi, type JiraSettingsUpdate, type JiraTestResult } from '../api/jiraSettings';
import type { JiraSettings } from '../types';

export const useJiraSettingsStore = defineStore('jiraSettings', () => {
  const settings = ref<JiraSettings | null>(null);
  const loading = ref(false);
  const saving = ref(false);
  const testing = ref(false);
  const error = ref<string | null>(null);

  async function fetch() {
    loading.value = true;
    error.value = null;
    try {
      settings.value = await jiraSettingsApi.get();
      return true;
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to load jira settings';
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function save(payload: JiraSettingsUpdate) {
    saving.value = true;
    error.value = null;
    try {
      settings.value = await jiraSettingsApi.update(payload);
      return true;
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to save jira settings';
      return false;
    } finally {
      saving.value = false;
    }
  }

  // Returns the structured JiraTestResult on success, or null when the request
  // itself failed (network/validation/authz) — distinct from a delivered result
  // whose own `ok` may be false.
  async function test(): Promise<JiraTestResult | null> {
    testing.value = true;
    error.value = null;
    try {
      return await jiraSettingsApi.test();
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to test the jira connection';
      return null;
    } finally {
      testing.value = false;
    }
  }

  return { settings, loading, saving, testing, error, fetch, save, test };
});
