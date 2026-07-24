import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { authApi } from '../api/auth';
import type { User } from '../types';
import { Role } from '../types';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const isAuthenticated = computed(() => !!user.value);
  const isAdmin = computed(() => user.value?.role === Role.ADMIN);
  const isPowerUser = computed(
    () => user.value?.role === Role.POWER_USER || user.value?.role === Role.ADMIN
  );
  const isUser = computed(() => !!user.value);

  async function login(email: string, password: string) {
    loading.value = true;
    error.value = null;
    try {
      const userData = await authApi.login(email, password);
      user.value = userData;
      return true;
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Login failed';
      return false;
    } finally {
      loading.value = false;
    }
  }

  // Returns true when it performed a full-page SSO redirect (RP-initiated
  // logout): the caller must NOT also client-side navigate in that case.
  async function logout(): Promise<boolean> {
    loading.value = true;
    try {
      const res = await authApi.logout();
      user.value = null;
      if (res?.redirectTo) {
        // Full-page navigation to the IdP end-session endpoint, which then
        // returns the browser to post_logout_redirect_uri.
        window.location.href = res.redirectTo;
        return true;
      }
      return false;
    } catch (err) {
      console.error('Logout error:', err);
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function checkAuth() {
    loading.value = true;
    try {
      const userData = await authApi.getCurrentUser();
      user.value = userData;
      return true;
    } catch (err) {
      user.value = null;
      return false;
    } finally {
      loading.value = false;
    }
  }

  return {
    user,
    loading,
    error,
    isAuthenticated,
    isAdmin,
    isPowerUser,
    isUser,
    login,
    logout,
    checkAuth,
  };
});
