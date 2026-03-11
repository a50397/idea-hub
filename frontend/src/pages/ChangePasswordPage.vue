<template>
  <v-container fluid>
    <v-row>
      <v-col cols="12" md="6" lg="4">
        <h1 class="text-h4 mb-2">{{ $t('changePassword.title') }}</h1>
        <p class="text-body-1 text-medium-emphasis mb-6">{{ $t('changePassword.subtitle') }}</p>

        <v-card>
          <v-card-text class="pa-6">
            <v-form @submit.prevent="handleSubmit">
              <v-text-field
                v-model="currentPassword"
                :label="$t('changePassword.currentPassword')"
                :type="showCurrentPassword ? 'text' : 'password'"
                prepend-inner-icon="mdi-lock"
                :append-inner-icon="showCurrentPassword ? 'mdi-eye' : 'mdi-eye-off'"
                @click:append-inner="showCurrentPassword = !showCurrentPassword"
                variant="outlined"
                :error-messages="errors.currentPassword"
                class="mb-2"
              ></v-text-field>

              <v-text-field
                v-model="newPassword"
                :label="$t('changePassword.newPassword')"
                :type="showNewPassword ? 'text' : 'password'"
                prepend-inner-icon="mdi-lock-outline"
                :append-inner-icon="showNewPassword ? 'mdi-eye' : 'mdi-eye-off'"
                @click:append-inner="showNewPassword = !showNewPassword"
                variant="outlined"
                :error-messages="errors.newPassword"
                :hint="$t('changePassword.passwordHint')"
                class="mb-2"
              ></v-text-field>

              <v-text-field
                v-model="confirmPassword"
                :label="$t('changePassword.confirmPassword')"
                :type="showConfirmPassword ? 'text' : 'password'"
                prepend-inner-icon="mdi-lock-check"
                :append-inner-icon="showConfirmPassword ? 'mdi-eye' : 'mdi-eye-off'"
                @click:append-inner="showConfirmPassword = !showConfirmPassword"
                variant="outlined"
                :error-messages="errors.confirmPassword"
                class="mb-2"
              ></v-text-field>

              <v-alert v-if="errorMessage" type="error" class="mb-4">
                {{ errorMessage }}
              </v-alert>

              <v-btn
                type="submit"
                block
                size="large"
                color="primary"
                :loading="loading"
              >
                {{ $t('changePassword.submit') }}
              </v-btn>
            </v-form>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-snackbar v-model="showSuccess" color="success" :timeout="3000">
      {{ $t('changePassword.success') }}
    </v-snackbar>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { authApi } from '../api/auth';
import { useAuthStore } from '../stores/auth';

const { t } = useI18n();
const router = useRouter();
const authStore = useAuthStore();

const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const showCurrentPassword = ref(false);
const showNewPassword = ref(false);
const showConfirmPassword = ref(false);
const loading = ref(false);
const errorMessage = ref('');
const showSuccess = ref(false);
let redirectTimer: ReturnType<typeof setTimeout> | null = null;

const errors = reactive({
  currentPassword: [] as string[],
  newPassword: [] as string[],
  confirmPassword: [] as string[],
});

function validateForm(): boolean {
  errors.currentPassword = [];
  errors.newPassword = [];
  errors.confirmPassword = [];

  if (!currentPassword.value) {
    errors.currentPassword.push(t('changePassword.currentPasswordRequired'));
  }
  if (!newPassword.value) {
    errors.newPassword.push(t('changePassword.newPasswordRequired'));
  } else if (newPassword.value.length < 6) {
    errors.newPassword.push(t('changePassword.passwordMinLength'));
  }
  if (!confirmPassword.value) {
    errors.confirmPassword.push(t('changePassword.confirmPasswordRequired'));
  } else if (newPassword.value !== confirmPassword.value) {
    errors.confirmPassword.push(t('changePassword.passwordsMismatch'));
  }

  return !errors.currentPassword.length && !errors.newPassword.length && !errors.confirmPassword.length;
}

onUnmounted(() => {
  if (redirectTimer) clearTimeout(redirectTimer);
});

async function handleSubmit() {
  if (!validateForm()) return;

  loading.value = true;
  errorMessage.value = '';

  try {
    await authApi.changePassword(currentPassword.value, newPassword.value);
    showSuccess.value = true;
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
    // Clear any existing timer and schedule redirect
    if (redirectTimer) clearTimeout(redirectTimer);
    redirectTimer = setTimeout(() => {
      authStore.user = null;
      router.replace({ path: '/login' });
    }, 2000);
  } catch (error: any) {
    errorMessage.value = error.response?.data?.error || t('changePassword.failed');
  } finally {
    loading.value = false;
  }
}
</script>
