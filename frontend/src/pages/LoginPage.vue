<template>
  <v-app>
    <v-main>
      <v-container fluid fill-height>
        <v-row align="center" justify="center">
          <v-col cols="12" sm="8" md="4">
            <v-card elevation="12">
              <v-card-title class="text-h4 text-center pa-6 bg-primary">
                <span class="text-white">IdeaHub</span>
              </v-card-title>
              <v-card-text class="pa-6">
                <v-form @submit.prevent="handleLogin">
                  <v-text-field
                    v-model="email"
                    label="Email"
                    type="email"
                    prepend-inner-icon="mdi-email"
                    variant="outlined"
                    :error-messages="emailErrors"
                    required
                  ></v-text-field>

                  <v-text-field
                    v-model="password"
                    label="Password"
                    :type="showPassword ? 'text' : 'password'"
                    prepend-inner-icon="mdi-lock"
                    :append-inner-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
                    @click:append-inner="showPassword = !showPassword"
                    variant="outlined"
                    :error-messages="passwordErrors"
                    required
                  ></v-text-field>

                  <v-alert v-if="authStore.error" type="error" class="mb-4">
                    {{ authStore.error }}
                  </v-alert>

                  <v-btn
                    type="submit"
                    block
                    size="large"
                    color="primary"
                    :loading="authStore.loading"
                  >
                    Login
                  </v-btn>
                </v-form>
              </v-card-text>
              <!-- <v-divider></v-divider>
              <v-card-text class="text-center text-caption pa-4">
                <p class="mb-2"><strong>Demo Accounts:</strong></p>
                <p>Admin: admin@ideahub.com / admin123</p>
                <p>Power User: power@ideahub.com / power123</p>
                <p>User: john@ideahub.com / user123</p>
              </v-card-text> -->
            </v-card>
          </v-col>
        </v-row>
      </v-container>
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const authStore = useAuthStore();

const email = ref('');
const password = ref('');
const showPassword = ref(false);
const emailErrors = ref<string[]>([]);
const passwordErrors = ref<string[]>([]);

async function handleLogin() {
  emailErrors.value = [];
  passwordErrors.value = [];

  if (!email.value) {
    emailErrors.value.push('Email is required');
  }
  if (!password.value) {
    passwordErrors.value.push('Password is required');
  }

  if (emailErrors.value.length || passwordErrors.value.length) {
    return;
  }

  const success = await authStore.login(email.value, password.value);
  if (success) {
    router.push({ name: 'Dashboard' });
  }
}
</script>
