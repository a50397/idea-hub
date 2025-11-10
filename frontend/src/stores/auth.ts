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

  async function logout() {
    loading.value = true;
    try {
      await authApi.logout();
      user.value = null;
    } catch (err) {
      console.error('Logout error:', err);
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
