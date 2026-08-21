<template>
  <v-container fluid class="page-container">
    <h1 class="text-h4 page-title">{{ $t('jiraSettings.title') }}</h1>

    <v-card class="mb-6">
      <v-card-title>{{ $t('jiraSettings.serverTitle') }}</v-card-title>
      <v-card-subtitle>{{ $t('jiraSettings.subtitle') }}</v-card-subtitle>
      <v-card-text>
        <!-- The background poller's own verdict, at the top of the card the admin
             opens to fix it: what is wrong (the same fixed reason catalog the test
             button uses) and since when. Present whenever the last RECORDED outcome
             was a failure — the poller writes only on a change of state, so the
             timestamp is when it STARTED failing, not the last attempt. -->
        <v-alert
          v-if="syncFailing"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-4"
        >
          {{ syncFailingText }}
        </v-alert>

        <v-form @submit.prevent="save">
          <v-switch
            v-model="form.enabled"
            :disabled="jiraStore.loading"
            color="primary"
            :label="$t('jiraSettings.enabled')"
            hide-details
            class="mb-2"
          ></v-switch>

          <v-text-field
            v-model="form.baseUrl"
            :disabled="jiraStore.loading"
            :label="$t('jiraSettings.baseUrl')"
            :hint="$t('jiraSettings.baseUrlHint')"
            persistent-hint
            variant="outlined"
            :error-messages="formErrors.baseUrl"
            autocomplete="off"
            class="mb-4"
          ></v-text-field>

          <v-text-field
            v-model="form.email"
            :disabled="jiraStore.loading"
            :label="$t('jiraSettings.email')"
            variant="outlined"
            :error-messages="formErrors.email"
            autocomplete="off"
            class="mb-2"
          ></v-text-field>

          <!-- API token is WRITE-ONLY: never populated from the server. The hint
               reflects whether a token is already stored, and switches to explain the
               re-entry rule (F2) as soon as baseUrl/email is edited away from the
               stored value. -->
          <v-text-field
            v-model="form.apiToken"
            :label="$t('jiraSettings.apiToken')"
            type="password"
            variant="outlined"
            :hint="tokenHint"
            persistent-hint
            :error-messages="formErrors.apiToken"
            :disabled="clearToken || jiraStore.loading"
            autocomplete="new-password"
            class="mb-4"
          ></v-text-field>

          <!-- Wipe affordance: like Webex, an explicit opt-in clears the stored token
               on save. Only shown when a token is actually stored. -->
          <v-checkbox
            v-if="jiraStore.settings?.hasToken"
            v-model="clearToken"
            :disabled="jiraStore.loading"
            color="primary"
            :label="$t('jiraSettings.clearToken')"
            :error-messages="formErrors.apiToken"
            hide-details="auto"
            density="compact"
            class="mb-2"
          ></v-checkbox>

          <!-- Installation-wide default Jira project: pick from the tech user's
               visible projects (item title shown, project key is the stored value) or
               type a raw key manually. Single-value (not `multiple`). -->
          <v-combobox
            :model-value="form.defaultProjectKey"
            @update:model-value="normalizeDefaultProjectKey"
            @keydown.enter.prevent
            :label="$t('jiraSettings.defaultProjectKey')"
            variant="outlined"
            clearable
            :disabled="jiraStore.loading"
            :loading="jiraProjectsLoading"
            :items="jiraProjectItems"
            item-title="title"
            item-value="value"
            :return-object="false"
            :hint="jiraProjectsHint"
            persistent-hint
            :error-messages="formErrors.defaultProjectKey"
            class="mb-4"
          ></v-combobox>

          <v-text-field
            v-model="form.issueTypeName"
            :disabled="jiraStore.loading"
            :label="$t('jiraSettings.issueTypeName')"
            variant="outlined"
            :error-messages="formErrors.issueTypeName"
            class="mb-2"
          ></v-text-field>

          <v-text-field
            v-model.number="form.pollIntervalMinutes"
            :disabled="jiraStore.loading"
            :label="$t('jiraSettings.pollIntervalMinutes')"
            type="number"
            variant="outlined"
            :error-messages="formErrors.pollIntervalMinutes"
            class="mb-2"
          ></v-text-field>

          <v-text-field
            v-model="form.cancelResolutions"
            :disabled="jiraStore.loading"
            :label="$t('jiraSettings.cancelResolutions')"
            :hint="$t('jiraSettings.cancelResolutionsHint')"
            persistent-hint
            variant="outlined"
          ></v-text-field>
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="primary" @click="save" :loading="jiraStore.saving" :disabled="jiraStore.loading">
          {{ $t('jiraSettings.save') }}
        </v-btn>
      </v-card-actions>
    </v-card>

    <v-card>
      <v-card-title>{{ $t('jiraSettings.testTitle') }}</v-card-title>
      <v-card-subtitle>{{ $t('jiraSettings.testSubtitle') }}</v-card-subtitle>
      <!-- Rendered only when there is a result: an always-present empty card body
           leaves a dead band between the subtitle and the action button. -->
      <v-card-text v-if="testResult !== null">
        <v-alert :type="testResult.type" variant="tonal" density="compact">
          {{ testResult.text }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn variant="outlined" @click="testConnection" :loading="jiraStore.testing">
          {{ $t('jiraSettings.sendTest') }}
        </v-btn>
      </v-card-actions>
    </v-card>

    <v-snackbar v-model="snackbar" :color="snackbarColor">
      {{ snackbarText }}
    </v-snackbar>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useJiraSettingsStore } from '../stores/jiraSettings';
import { jiraSettingsApi } from '../api/jiraSettings';
import type { JiraSettingsUpdate } from '../api/jiraSettings';
import type { JiraProject } from '../types';

const { t, te, locale } = useI18n();
const jiraStore = useJiraSettingsStore();

const form = reactive({
  enabled: false,
  baseUrl: '',
  email: '',
  // API token is write-only and ALWAYS starts empty — it is never populated from
  // the server (which never returns it).
  apiToken: '',
  defaultProjectKey: '',
  issueTypeName: '',
  pollIntervalMinutes: 5,
  cancelResolutions: '',
});

// Opt-in to wipe the stored token on the next save. Reset whenever the masked
// settings are (re)applied.
const clearToken = ref(false);

// Checking "clear the saved token" WINS over any leftover typed text (mirrors
// WebexSettingsPage exactly).
watch(clearToken, (checked) => {
  if (checked) {
    form.apiToken = '';
    formErrors.apiToken = [];
  }
});

const formErrors = reactive({
  baseUrl: [] as string[],
  email: [] as string[],
  apiToken: [] as string[],
  defaultProjectKey: [] as string[],
  issueTypeName: [] as string[],
  pollIntervalMinutes: [] as string[],
});

const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref('success');
// The inline test-result banner: a small view model (alert type + already-resolved
// message). Never holds raw server text — failure messages come from a fixed
// reason -> i18n key.
const testResult = ref<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);

// The tech user's visible Jira projects, loaded on mount, powering the
// default-project picker. Same always-200-with-reason contract as the Webex rooms /
// departments picker.
const jiraProjects = ref<JiraProject[]>([]);
const jiraProjectsUnavailable = ref(false);
const jiraProjectsLoading = ref(false);

const jiraProjectItems = computed(() =>
  jiraProjects.value.map((p) => ({ title: `${p.key} — ${p.name}`, value: p.key }))
);

const jiraProjectsHint = computed(() => {
  if (jiraProjectsLoading.value) return t('jiraSettings.defaultProjectKeyLoading');
  if (jiraProjectsUnavailable.value) return t('jiraSettings.defaultProjectKeyUnavailable');
  if (jiraProjects.value.length === 0) return t('jiraSettings.defaultProjectKeyEmpty');
  return t('jiraSettings.defaultProjectKeyHint');
});

// --- background-sync health -------------------------------------------------
// Shown only for a RECORDED failure: `lastSync` is null until the poller has run at
// all, and `ok: true` means healthy — neither is a warning.
const syncFailing = computed(() => jiraStore.settings?.lastSync?.ok === false);

// Same locale-aware formatting as the idea pages; date + time because "failing
// since" is only useful at that resolution.
function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  const loc = locale.value === 'sk' ? 'sk-SK' : 'en-US';
  return date.toLocaleString(loc, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// The failure reason travels as one of a CLOSED set of codes, so it is resolved
// through the EXISTING testReason catalog (never rendered as raw server text) with
// the same te()-guarded 'unknown' fallback the test button uses — a code from a
// newer backend degrades to a generic sentence instead of a missing-key string.
const syncFailingText = computed(() => {
  const last = jiraStore.settings?.lastSync;
  if (!last) return '';
  const key = `jiraSettings.testReason.${last.reason}`;
  const reason = last.reason && te(key) ? t(key) : t('jiraSettings.testReason.unknown');
  return t('jiraSettings.syncFailing', { since: formatDateTime(last.at), reason });
});

// Whether this save would change the identity fields the stored token is bound to
// (security review F2). Compares against the STORED masked settings, not the
// in-progress form-only state.
const identityChanged = computed(() => {
  const s = jiraStore.settings;
  if (!s) return false;
  return form.baseUrl.trim() !== s.baseUrl || form.email.trim() !== s.email;
});

// Reflects whether a token is already stored (write-only field semantics), UNLESS
// this save would change baseUrl/email while keeping the stored token — then the
// hint proactively explains the backend's F2 rule before the admin even saves.
const tokenHint = computed(() => {
  const s = jiraStore.settings;
  const changesToken = clearToken.value || form.apiToken.trim().length > 0;
  if (identityChanged.value && s?.hasToken && !changesToken) {
    return t('jiraSettings.identityChangeRequiresToken');
  }
  return s?.hasToken ? t('jiraSettings.tokenHintSet') : t('jiraSettings.tokenHintUnset');
});

function notify(text: string, color: string) {
  snackbarText.value = text;
  snackbarColor.value = color;
  snackbar.value = true;
}

function showTestResult(type: 'success' | 'warning' | 'error', text: string) {
  testResult.value = { type, text };
  notify(text, type);
}

// Copy the masked settings into the local form (token stays empty, clear-token reset).
function applySettings() {
  const s = jiraStore.settings;
  if (!s) return;
  form.enabled = s.enabled;
  form.baseUrl = s.baseUrl;
  form.email = s.email;
  form.apiToken = '';
  form.defaultProjectKey = s.defaultProjectKey;
  form.issueTypeName = s.issueTypeName;
  form.pollIntervalMinutes = s.pollIntervalMinutes;
  form.cancelResolutions = s.cancelResolutions;
  clearToken.value = false;
}

// Sync the form to the store the MOMENT `settings` changes, rather than only once
// onMounted's `await jiraStore.fetch()` resumes. That extra microtask hop otherwise
// lets the store's `settings` (fresh) and this page's `form` (still blank) render
// out of step for one pass: `identityChanged` briefly reads true against the
// not-yet-applied form, flashing the F2 re-entry warning before settling on the
// correct hint. A default (pre-flush) watcher runs before this component's own
// re-render, so `form` is already in sync by the time `tokenHint` is computed.
watch(
  () => jiraStore.settings,
  (s) => {
    if (s) applySettings();
  }
);

// The combobox is bound to a SINGLE key string (not `multiple`): picking a project
// contributes its key, typing contributes the raw text, clearing emits null —
// coerce every shape to a trimmed, uppercased string (the backend uppercases too).
function normalizeDefaultProjectKey(value: string | { value?: string } | null) {
  const raw = typeof value === 'string' ? value : value?.value ?? '';
  form.defaultProjectKey = raw.trim().toUpperCase();
}

function validate(): boolean {
  formErrors.baseUrl = [];
  formErrors.email = [];
  formErrors.apiToken = [];
  formErrors.defaultProjectKey = [];
  formErrors.issueTypeName = [];
  formErrors.pollIntervalMinutes = [];
  let ok = true;

  // Client-side guards for states the backend intentionally does NOT reject (an
  // enabled channel with a missing piece silently degrades to not effectively
  // enabled) — fast, friendly feedback instead of a confusing half-configured save.
  if (form.enabled && !form.baseUrl.trim()) {
    formErrors.baseUrl.push(t('jiraSettings.baseUrlRequired'));
    ok = false;
  } else if (form.baseUrl.trim().length > 0 && !/^https:\/\//i.test(form.baseUrl.trim())) {
    formErrors.baseUrl.push(t('jiraSettings.baseUrlInvalid'));
    ok = false;
  }

  if (form.enabled && !form.email.trim()) {
    formErrors.email.push(t('jiraSettings.emailRequired'));
    ok = false;
  }

  const willHaveToken =
    form.apiToken.trim().length > 0 || (!!jiraStore.settings?.hasToken && !clearToken.value);
  const changesToken = clearToken.value || form.apiToken.trim().length > 0;
  if (form.enabled && !willHaveToken) {
    formErrors.apiToken.push(t('jiraSettings.tokenRequired'));
    ok = false;
  } else if (identityChanged.value && jiraStore.settings?.hasToken && !changesToken) {
    // Mirrors the backend's F2 400 so the admin sees the same rule as an error the
    // moment they try to save, not just as a passive hint.
    formErrors.apiToken.push(t('jiraSettings.identityChangeRequiresToken'));
    ok = false;
  }

  // Mirror DepartmentsPage's client-side project-key rule (the backend zod schema is
  // authoritative and rejects the same shapes): letter first, then letters/digits/_,
  // max 32; empty is allowed (not configured). Without this the binding on the field
  // was dead state and an invalid key surfaced only as the backend's English 400
  // (deep-review fix).
  const projectKey = form.defaultProjectKey.trim();
  if (projectKey.length > 32) {
    formErrors.defaultProjectKey.push(t('departments.jiraProjectKeyTooLong'));
    ok = false;
  } else if (projectKey.length > 0 && !/^[A-Za-z][A-Za-z0-9_]*$/.test(projectKey)) {
    formErrors.defaultProjectKey.push(t('departments.jiraProjectKeyInvalid'));
    ok = false;
  }

  // issueTypeName is REQUIRED unconditionally (matches the backend schema, which
  // does not gate it on `enabled` — an empty issue type is never a valid save).
  if (!form.issueTypeName.trim()) {
    formErrors.issueTypeName.push(t('jiraSettings.issueTypeRequired'));
    ok = false;
  }

  const poll = Number(form.pollIntervalMinutes);
  if (!Number.isInteger(poll) || poll < 1 || poll > 1440) {
    formErrors.pollIntervalMinutes.push(t('jiraSettings.pollIntervalInvalid'));
    ok = false;
  }

  return ok;
}

async function save() {
  // Drop any stale inline test-result banner before saving: once the config is
  // (re)saved without re-testing, an earlier result no longer reflects the stored
  // settings and must not imply the new config was verified.
  testResult.value = null;
  if (!validate()) return;

  const payload: JiraSettingsUpdate = {
    enabled: form.enabled,
    baseUrl: form.baseUrl.trim(),
    email: form.email.trim(),
    defaultProjectKey: form.defaultProjectKey.trim().toUpperCase(),
    issueTypeName: form.issueTypeName.trim(),
    pollIntervalMinutes: Number(form.pollIntervalMinutes),
    cancelResolutions: form.cancelResolutions.trim(),
  };
  // Token keep/set/wipe — wipe WINS (mirrors WebexSettingsPage exactly).
  if (clearToken.value) {
    payload.apiToken = '';
  } else if (form.apiToken.trim().length > 0) {
    payload.apiToken = form.apiToken.trim();
  }

  const ok = await jiraStore.save(payload);
  if (ok) {
    applySettings(); // refresh hasToken hint + clear the token field and checkbox
    notify(t('jiraSettings.saveSuccess'), 'success');
    // Saved settings may point at a DIFFERENT Jira account or site (new email /
    // token / base URL): the picker must not keep offering the old account's
    // projects (they were loaded on mount only).
    loadJiraProjects();
  } else {
    notify(jiraStore.error || t('jiraSettings.saveFailed'), 'error');
  }
}

async function testConnection() {
  testResult.value = null;
  const result = await jiraStore.test();
  if (result === null) {
    // The request itself failed (network / unexpected) — the store holds the error.
    showTestResult('error', jiraStore.error || t('jiraSettings.testFailed'));
    return;
  }
  if (result.ok) {
    showTestResult('success', t('jiraSettings.testSuccess'));
  } else {
    // Translate the FIXED reason category into a friendly, admin-facing message.
    // Fall back to the 'unknown' wording if a reason is ever unmapped (belt-and-
    // braces; the union is exhaustive today).
    const key = `jiraSettings.testReason.${result.reason}`;
    showTestResult('error', te(key) ? t(key) : t('jiraSettings.testReason.unknown'));
  }
}

async function loadJiraProjects() {
  jiraProjectsLoading.value = true;
  try {
    const { projects, reason } = await jiraSettingsApi.getProjects();
    jiraProjects.value = projects;
    jiraProjectsUnavailable.value = reason !== undefined;
  } catch {
    jiraProjects.value = [];
    jiraProjectsUnavailable.value = true;
  } finally {
    jiraProjectsLoading.value = false;
  }
}

onMounted(async () => {
  await jiraStore.fetch();
  applySettings();
  loadJiraProjects();
});
</script>
