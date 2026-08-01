<template>
  <v-container fluid class="page-container">
    <h1 class="text-h4 page-title">{{ $t('webexSettings.title') }}</h1>

    <v-card class="mb-6">
      <v-card-title>{{ $t('webexSettings.serverTitle') }}</v-card-title>
      <v-card-subtitle>{{ $t('webexSettings.subtitle') }}</v-card-subtitle>
      <v-card-text>
        <v-form @submit.prevent="save">
          <v-switch
            v-model="form.enabled"
            :disabled="webexStore.loading"
            color="primary"
            :label="$t('webexSettings.enabled')"
            hide-details
            class="mb-2"
          ></v-switch>

          <!-- Bot token is WRITE-ONLY: never populated from the server. The hint
               reflects whether a token is already stored. -->
          <v-text-field
            v-model="form.token"
            :label="$t('webexSettings.token')"
            type="password"
            variant="outlined"
            :hint="tokenHint"
            persistent-hint
            :error-messages="formErrors.token"
            :disabled="clearToken || webexStore.loading"
            autocomplete="new-password"
            class="mb-2"
          ></v-text-field>

          <!-- Wipe affordance: webex has no username to key the wipe off (as mail
               does), so an explicit opt-in clears the stored token on save. Only
               shown when a token is actually stored. -->
          <!-- The enabled-requires-token guard also surfaces here: clearing the only
               stored token while Webex is enabled disables the (now empty) token
               field above, so the same error is shown at the control the admin used.
               Shares formErrors.token, so it clears wherever that clears. -->
          <v-checkbox
            v-if="webexStore.settings?.hasToken"
            v-model="clearToken"
            :disabled="webexStore.loading"
            color="primary"
            :label="$t('webexSettings.clearToken')"
            :error-messages="formErrors.token"
            hide-details="auto"
            density="compact"
            class="mb-2"
          ></v-checkbox>

          <v-select
            v-model="form.language"
            :disabled="webexStore.loading"
            :label="$t('webexSettings.language')"
            :items="languageItems"
            variant="outlined"
          ></v-select>
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="primary" @click="save" :loading="webexStore.saving" :disabled="webexStore.loading">
          {{ $t('webexSettings.save') }}
        </v-btn>
      </v-card-actions>
    </v-card>

    <v-card>
      <v-card-title>{{ $t('webexSettings.testTitle') }}</v-card-title>
      <v-card-subtitle>{{ $t('webexSettings.testSubtitle') }}</v-card-subtitle>
      <v-card-text>
        <v-text-field
          v-model="testTo"
          :label="$t('webexSettings.testRecipient')"
          variant="outlined"
          :error-messages="formErrors.testTo"
          autocomplete="off"
        ></v-text-field>
        <v-alert
          v-if="testResult !== null"
          :type="testResult.type"
          variant="tonal"
          density="compact"
          class="mb-2"
        >
          {{ testResult.text }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn variant="outlined" @click="sendTest" :loading="webexStore.testing">
          {{ $t('webexSettings.sendTest') }}
        </v-btn>
      </v-card-actions>
    </v-card>

    <v-snackbar v-model="snackbar" :color="snackbarColor">
      {{ snackbarText }}
    </v-snackbar>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useWebexSettingsStore } from '../stores/webexSettings';
import { useAuthStore } from '../stores/auth';
import type { WebexSettingsUpdate } from '../api/webexSettings';

const { t, te } = useI18n();
const webexStore = useWebexSettingsStore();
const authStore = useAuthStore();

// Pragmatic email shape check for inline feedback; the backend (zod .email()) is
// the authority.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const form = reactive({
  enabled: false,
  // The bot token is write-only and ALWAYS starts empty — it is never populated
  // from the server (which never returns it).
  token: '',
  language: 'sk' as 'en' | 'sk',
});

// Opt-in to wipe the stored token on the next save (see the checkbox above). Reset
// whenever the masked settings are (re)applied.
const clearToken = ref(false);

// Checking "clear the saved token" WINS over any leftover typed text: empty the
// (now disabled) field and drop its stale error so the UI never communicates a wipe
// while a typed token still lingers in the model. This also makes validate() correct
// for free — with the field emptied, the enabled-requires-token guard fires when the
// admin clears the only token while Webex is enabled.
watch(clearToken, (checked) => {
  if (checked) {
    form.token = '';
    formErrors.token = [];
  }
});

const formErrors = reactive({
  token: [] as string[],
  testTo: [] as string[],
});

const testTo = ref('');
// The inline test-result banner: a small view model (alert type + already-resolved
// message) so it renders success/failure uniformly. Never holds raw server text —
// failure messages come from a fixed reason -> i18n key.
const testResult = ref<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);

const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref('success');

const languageItems = computed(() => [
  { title: t('webexSettings.languageEn'), value: 'en' },
  { title: t('webexSettings.languageSk'), value: 'sk' },
]);

// Reflects whether a token is already stored (write-only field semantics).
const tokenHint = computed(() =>
  webexStore.settings?.hasToken ? t('webexSettings.tokenHintSet') : t('webexSettings.tokenHintUnset')
);

function notify(text: string, color: string) {
  snackbarText.value = text;
  snackbarColor.value = color;
  snackbar.value = true;
}

// Show the test-send outcome both inline (persistent banner) and as an ephemeral
// snackbar, using the same already-resolved text and alert/snackbar color.
function showTestResult(type: 'success' | 'warning' | 'error', text: string) {
  testResult.value = { type, text };
  notify(text, type);
}

// Copy the masked settings into the local form (token stays empty, clear-token reset).
function applySettings() {
  const s = webexStore.settings;
  if (!s) return;
  form.enabled = s.enabled;
  form.language = s.language;
  form.token = '';
  clearToken.value = false;
}

function validate(): boolean {
  formErrors.token = [];
  let ok = true;

  // Client-side guard for the state the backend intentionally does NOT reject: an
  // enabled channel with no effective token silently degrades to disabled. Block
  // the save so the admin isn't left with a confusing half-configured "enabled".
  // A token will exist after this save when the admin typed one, OR one is stored
  // and is not being cleared.
  const willHaveToken =
    form.token.trim().length > 0 || (!!webexStore.settings?.hasToken && !clearToken.value);
  if (form.enabled && !willHaveToken) {
    formErrors.token.push(t('webexSettings.tokenRequired'));
    ok = false;
  }
  return ok;
}

async function save() {
  // Drop any stale inline test-result banner before saving: once the config is
  // (re)saved without re-testing, an earlier "test sent" result no longer reflects
  // the stored settings and must not imply the new config was verified.
  testResult.value = null;
  if (!validate()) return;

  const payload: WebexSettingsUpdate = {
    enabled: form.enabled,
    language: form.language,
  };
  // Token keep/set/wipe — wipe WINS: send an empty string when the admin opted to
  // clear the stored token (even if stale text lingers in the model); else send a
  // newly typed token (set); else omit the field entirely so the stored token is kept.
  if (clearToken.value) {
    payload.token = '';
  } else if (form.token.length > 0) {
    payload.token = form.token;
  }

  const ok = await webexStore.save(payload);
  if (ok) {
    applySettings(); // refresh hasToken hint + clear the token field and checkbox
    notify(t('webexSettings.saveSuccess'), 'success');
  } else {
    notify(webexStore.error || t('webexSettings.saveFailed'), 'error');
  }
}

async function sendTest() {
  formErrors.testTo = [];
  testResult.value = null;
  if (!EMAIL_RE.test(testTo.value.trim())) {
    formErrors.testTo.push(t('webexSettings.recipientInvalid'));
    return;
  }
  const result = await webexStore.sendTest(testTo.value.trim());
  if (result === null) {
    // The request itself failed (network / unexpected) — the store holds the error.
    showTestResult('error', webexStore.error || t('webexSettings.testFailed'));
    return;
  }
  if (result.ok) {
    showTestResult('success', t('webexSettings.testSuccess'));
  } else {
    // Translate the FIXED reason category into a friendly, admin-facing message.
    // Fall back to the 'unknown' wording if a reason is ever unmapped (belt-and-
    // braces; the union is exhaustive today).
    const key = `webexSettings.testReason.${result.reason}`;
    showTestResult('error', te(key) ? t(key) : t('webexSettings.testReason.unknown'));
  }
}

onMounted(async () => {
  await webexStore.fetch();
  applySettings();
  // Prefill the test recipient with the admin's own email when available.
  testTo.value = authStore.user?.email ?? '';
});
</script>
