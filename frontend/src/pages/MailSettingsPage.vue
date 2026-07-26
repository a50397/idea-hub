<template>
  <v-container fluid class="page-container">
    <h1 class="text-h4 page-title">{{ $t('mailSettings.title') }}</h1>

    <v-card class="mb-6">
      <v-card-title>{{ $t('mailSettings.serverTitle') }}</v-card-title>
      <v-card-subtitle>{{ $t('mailSettings.subtitle') }}</v-card-subtitle>
      <v-card-text>
        <v-form @submit.prevent="save">
          <v-switch
            v-model="form.enabled"
            color="primary"
            :label="$t('mailSettings.enabled')"
            hide-details
            class="mb-2"
          ></v-switch>

          <v-text-field
            v-model="form.host"
            :label="$t('mailSettings.host')"
            variant="outlined"
            :error-messages="formErrors.host"
            autocomplete="off"
          ></v-text-field>

          <v-text-field
            v-model.number="form.port"
            :label="$t('mailSettings.port')"
            type="number"
            variant="outlined"
            :error-messages="formErrors.port"
          ></v-text-field>

          <v-switch
            v-model="form.secure"
            color="primary"
            :label="$t('mailSettings.secure')"
            hide-details
            class="mb-2"
          ></v-switch>

          <v-text-field
            v-model="form.username"
            :label="$t('mailSettings.username')"
            variant="outlined"
            autocomplete="off"
          ></v-text-field>

          <!-- Password is WRITE-ONLY: never populated from the server. The hint
               reflects whether a password is already stored. -->
          <v-text-field
            v-model="form.password"
            :label="$t('mailSettings.password')"
            type="password"
            variant="outlined"
            :hint="passwordHint"
            persistent-hint
            autocomplete="new-password"
            class="mb-2"
          ></v-text-field>

          <v-text-field
            v-model="form.from"
            :label="$t('mailSettings.from')"
            variant="outlined"
            :error-messages="formErrors.from"
          ></v-text-field>

          <v-select
            v-model="form.language"
            :label="$t('mailSettings.language')"
            :items="languageItems"
            variant="outlined"
          ></v-select>

          <v-text-field
            v-model="form.subjectTemplate"
            :label="$t('mailSettings.subjectTemplate')"
            variant="outlined"
          ></v-text-field>
          <div class="text-caption text-medium-emphasis mt-n2 mb-2">
            {{ $t('mailSettings.subjectTemplateHint') }} <code>{department}</code>, <code>{title}</code>
          </div>
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="primary" @click="save" :loading="mailStore.saving">
          {{ $t('mailSettings.save') }}
        </v-btn>
      </v-card-actions>
    </v-card>

    <v-card>
      <v-card-title>{{ $t('mailSettings.testTitle') }}</v-card-title>
      <v-card-subtitle>{{ $t('mailSettings.testSubtitle') }}</v-card-subtitle>
      <v-card-text>
        <v-text-field
          v-model="testTo"
          :label="$t('mailSettings.testRecipient')"
          variant="outlined"
          :error-messages="formErrors.testTo"
          autocomplete="off"
        ></v-text-field>
        <v-alert
          v-if="testResult !== null"
          :type="testResult ? 'success' : 'error'"
          variant="tonal"
          density="compact"
          class="mb-2"
        >
          {{ testResult ? $t('mailSettings.testSuccess') : $t('mailSettings.testFailed') }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn variant="outlined" @click="sendTest" :loading="mailStore.testing">
          {{ $t('mailSettings.sendTest') }}
        </v-btn>
      </v-card-actions>
    </v-card>

    <v-snackbar v-model="snackbar" :color="snackbarColor">
      {{ snackbarText }}
    </v-snackbar>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMailSettingsStore } from '../stores/mailSettings';
import { useAuthStore } from '../stores/auth';
import type { MailSettingsUpdate } from '../api/mailSettings';

const { t } = useI18n();
const mailStore = useMailSettingsStore();
const authStore = useAuthStore();

// Pragmatic email shape check for inline feedback; the backend (zod .email()) is
// the authority.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const form = reactive({
  enabled: false,
  host: '',
  port: 587,
  // Password is write-only and ALWAYS starts empty — it is never populated from
  // the server (which never returns it).
  secure: false,
  username: '',
  password: '',
  from: 'IdeaHub <no-reply@ideahub.local>',
  language: 'en' as 'en' | 'sk',
  subjectTemplate: '',
});

const formErrors = reactive({
  host: [] as string[],
  port: [] as string[],
  from: [] as string[],
  testTo: [] as string[],
});

const testTo = ref('');
const testResult = ref<boolean | null>(null);

const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref('success');

const languageItems = computed(() => [
  { title: t('mailSettings.languageEn'), value: 'en' },
  { title: t('mailSettings.languageSk'), value: 'sk' },
]);

// Reflects whether a password is already stored (write-only field semantics).
const passwordHint = computed(() =>
  mailStore.settings?.hasPassword ? t('mailSettings.passwordHintSet') : t('mailSettings.passwordHintUnset')
);

function notify(text: string, color: string) {
  snackbarText.value = text;
  snackbarColor.value = color;
  snackbar.value = true;
}

// Copy the masked settings into the local form (password stays empty).
function applySettings() {
  const s = mailStore.settings;
  if (!s) return;
  form.enabled = s.enabled;
  form.host = s.host;
  form.port = s.port;
  form.secure = s.secure;
  form.username = s.username;
  form.from = s.from;
  form.language = s.language;
  form.subjectTemplate = s.subjectTemplate;
  form.password = '';
}

function validate(): boolean {
  formErrors.host = [];
  formErrors.port = [];
  formErrors.from = [];
  let ok = true;

  // Mirror the backend save-time guard for fast feedback.
  if (form.enabled && !form.host.trim()) {
    formErrors.host.push(t('mailSettings.hostRequired'));
    ok = false;
  }
  const port = Number(form.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    formErrors.port.push(t('mailSettings.portInvalid'));
    ok = false;
  }
  if (!form.from.trim()) {
    formErrors.from.push(t('mailSettings.fromRequired'));
    ok = false;
  }
  return ok;
}

async function save() {
  if (!validate()) return;

  const payload: MailSettingsUpdate = {
    enabled: form.enabled,
    host: form.host.trim(),
    port: Number(form.port),
    secure: form.secure,
    username: form.username.trim(),
    from: form.from.trim(),
    language: form.language,
    subjectTemplate: form.subjectTemplate.trim(),
  };
  // Only send the password when the admin actually typed one; an empty field
  // means "keep the stored password" (or the server wipes it when username is empty).
  if (form.password.length > 0) {
    payload.password = form.password;
  }

  const ok = await mailStore.save(payload);
  if (ok) {
    applySettings(); // refresh hasPassword hint + clear the password field
    notify(t('mailSettings.saveSuccess'), 'success');
  } else {
    notify(mailStore.error || t('mailSettings.saveFailed'), 'error');
  }
}

async function sendTest() {
  formErrors.testTo = [];
  testResult.value = null;
  if (!EMAIL_RE.test(testTo.value.trim())) {
    formErrors.testTo.push(t('mailSettings.recipientInvalid'));
    return;
  }
  const result = await mailStore.sendTest(testTo.value.trim());
  if (result === null) {
    notify(mailStore.error || t('mailSettings.testFailed'), 'error');
    return;
  }
  testResult.value = result.ok;
  notify(result.ok ? t('mailSettings.testSuccess') : t('mailSettings.testFailed'), result.ok ? 'success' : 'error');
}

onMounted(async () => {
  await mailStore.fetch();
  applySettings();
  // Prefill the test recipient with the admin's own email when available.
  testTo.value = authStore.user?.email ?? '';
});
</script>
