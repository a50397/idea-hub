import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { departmentsApi } from '../api/departments';
import type { Department } from '../types';

export const useDepartmentsStore = defineStore('departments', () => {
  const departments = ref<Department[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Admin-defined order; the submit form's default is the first of this list.
  const sortedByOrder = computed(() =>
    [...departments.value].sort((a, b) => a.order - b.order)
  );
  const defaultDepartment = computed<Department | null>(() => sortedByOrder.value[0] ?? null);

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      departments.value = await departmentsApi.getAll();
      return true;
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to load departments';
      return false;
    } finally {
      loading.value = false;
    }
  }

  // POST returns a bare department (no _count), so refetch for the full shape.
  async function create(name: string) {
    loading.value = true;
    error.value = null;
    try {
      await departmentsApi.create(name);
      departments.value = await departmentsApi.getAll();
      return true;
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to create department';
      return false;
    } finally {
      loading.value = false;
    }
  }

  // PATCH rename returns a bare department (no _count), so refetch.
  async function rename(id: string, name: string) {
    loading.value = true;
    error.value = null;
    try {
      await departmentsApi.rename(id, name);
      departments.value = await departmentsApi.getAll();
      return true;
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to rename department';
      return false;
    } finally {
      loading.value = false;
    }
  }

  // Reorder returns the full, reordered list (with _count) — use it directly.
  async function reorder(ids: string[]) {
    loading.value = true;
    error.value = null;
    try {
      departments.value = await departmentsApi.reorder(ids);
      return true;
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to reorder departments';
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function remove(id: string) {
    loading.value = true;
    error.value = null;
    try {
      await departmentsApi.remove(id);
      departments.value = await departmentsApi.getAll();
      return true;
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to delete department';
      return false;
    } finally {
      loading.value = false;
    }
  }

  return {
    departments,
    loading,
    error,
    sortedByOrder,
    defaultDepartment,
    fetchAll,
    create,
    rename,
    reorder,
    remove,
  };
});
