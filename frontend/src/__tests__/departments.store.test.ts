import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useDepartmentsStore } from '../stores/departments';
import type { Department } from '../types';

// Replace the real network layer; the store must never hit axios.
vi.mock('../api/departments', () => ({
  departmentsApi: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    reorder: vi.fn(),
    remove: vi.fn(),
  },
}));

import { departmentsApi } from '../api/departments';
const mockedApi = vi.mocked(departmentsApi);

function dept(id: string, name: string, order: number): Department {
  return {
    id,
    name,
    order,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('departments store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('fetchAll', () => {
    it('loads departments, exposes them sorted by order, and clears error', async () => {
      mockedApi.getAll.mockResolvedValueOnce([dept('c', 'C', 2), dept('a', 'A', 0), dept('b', 'B', 1)]);
      const store = useDepartmentsStore();

      const ok = await store.fetchAll();

      expect(ok).toBe(true);
      expect(mockedApi.getAll).toHaveBeenCalledTimes(1);
      expect(store.sortedByOrder.map((d) => d.id)).toEqual(['a', 'b', 'c']);
      expect(store.error).toBeNull();
      expect(store.loading).toBe(false);
    });

    it('captures the server error message on failure', async () => {
      mockedApi.getAll.mockRejectedValueOnce({ response: { data: { error: 'boom' } } });
      const store = useDepartmentsStore();

      const ok = await store.fetchAll();

      expect(ok).toBe(false);
      expect(store.error).toBe('boom');
      expect(store.loading).toBe(false);
    });

    it('falls back to a generic message when the server sends none', async () => {
      mockedApi.getAll.mockRejectedValueOnce(new Error('network down'));
      const store = useDepartmentsStore();

      const ok = await store.fetchAll();

      expect(ok).toBe(false);
      expect(store.error).toBe('Failed to load departments');
    });
  });

  describe('getters', () => {
    it('defaultDepartment is the first department by order', async () => {
      mockedApi.getAll.mockResolvedValueOnce([dept('b', 'B', 5), dept('a', 'A', 1)]);
      const store = useDepartmentsStore();
      await store.fetchAll();

      expect(store.defaultDepartment?.id).toBe('a');
    });

    it('defaultDepartment is null and sortedByOrder empty with no departments', () => {
      const store = useDepartmentsStore();

      expect(store.defaultDepartment).toBeNull();
      expect(store.sortedByOrder).toEqual([]);
    });
  });

  describe('create', () => {
    it('calls the api and refetches to pick up the _count shape', async () => {
      mockedApi.create.mockResolvedValueOnce(dept('n', 'New', 3));
      mockedApi.getAll.mockResolvedValueOnce([dept('n', 'New', 3)]);
      const store = useDepartmentsStore();

      const ok = await store.create('New');

      expect(ok).toBe(true);
      expect(mockedApi.create).toHaveBeenCalledWith('New');
      expect(mockedApi.getAll).toHaveBeenCalledTimes(1);
      expect(store.departments.map((d) => d.id)).toEqual(['n']);
    });

    it('captures a 409 duplicate error and does not refetch', async () => {
      mockedApi.create.mockRejectedValueOnce({
        response: { data: { error: 'A department with this name already exists' } },
      });
      const store = useDepartmentsStore();

      const ok = await store.create('Duplicate');

      expect(ok).toBe(false);
      expect(store.error).toBe('A department with this name already exists');
      expect(mockedApi.getAll).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('calls the api with (id, payload) and refetches', async () => {
      mockedApi.update.mockResolvedValueOnce(dept('a', 'Renamed', 0));
      mockedApi.getAll.mockResolvedValueOnce([dept('a', 'Renamed', 0)]);
      const store = useDepartmentsStore();

      const ok = await store.update('a', { name: 'Renamed' });

      expect(ok).toBe(true);
      expect(mockedApi.update).toHaveBeenCalledWith('a', { name: 'Renamed' });
      expect(mockedApi.getAll).toHaveBeenCalledTimes(1);
    });

    it('forwards a notificationEmails-only payload', async () => {
      mockedApi.update.mockResolvedValueOnce(dept('a', 'A', 0));
      mockedApi.getAll.mockResolvedValueOnce([dept('a', 'A', 0)]);
      const store = useDepartmentsStore();

      const ok = await store.update('a', { notificationEmails: ['ops@corp.example'] });

      expect(ok).toBe(true);
      expect(mockedApi.update).toHaveBeenCalledWith('a', { notificationEmails: ['ops@corp.example'] });
    });

    it('forwards a webexRoomIds-only payload', async () => {
      mockedApi.update.mockResolvedValueOnce(dept('a', 'A', 0));
      mockedApi.getAll.mockResolvedValueOnce([dept('a', 'A', 0)]);
      const store = useDepartmentsStore();

      const ok = await store.update('a', { webexRoomIds: ['room-a', 'room-b'] });

      expect(ok).toBe(true);
      expect(mockedApi.update).toHaveBeenCalledWith('a', { webexRoomIds: ['room-a', 'room-b'] });
    });

    it('captures a 409 duplicate name error', async () => {
      mockedApi.update.mockRejectedValueOnce({
        response: { data: { error: 'A department with this name already exists' } },
      });
      const store = useDepartmentsStore();

      const ok = await store.update('a', { name: 'Dup' });

      expect(ok).toBe(false);
      expect(store.error).toBe('A department with this name already exists');
    });
  });

  describe('reorder', () => {
    it('uses the returned full array directly and does not refetch', async () => {
      const reordered = [dept('b', 'B', 0), dept('a', 'A', 1)];
      mockedApi.reorder.mockResolvedValueOnce(reordered);
      const store = useDepartmentsStore();

      const ok = await store.reorder(['b', 'a']);

      expect(ok).toBe(true);
      expect(mockedApi.reorder).toHaveBeenCalledWith(['b', 'a']);
      expect(mockedApi.getAll).not.toHaveBeenCalled();
      expect(store.sortedByOrder.map((d) => d.id)).toEqual(['b', 'a']);
    });

    it('captures the error on a non-permutation (400)', async () => {
      mockedApi.reorder.mockRejectedValueOnce({
        response: { data: { error: 'ids must be an exact permutation of all department ids' } },
      });
      const store = useDepartmentsStore();

      const ok = await store.reorder(['x']);

      expect(ok).toBe(false);
      expect(store.error).toBe('ids must be an exact permutation of all department ids');
    });
  });

  describe('remove', () => {
    it('calls the api and refetches', async () => {
      mockedApi.remove.mockResolvedValueOnce({ message: 'Department deleted successfully' });
      mockedApi.getAll.mockResolvedValueOnce([]);
      const store = useDepartmentsStore();

      const ok = await store.remove('a');

      expect(ok).toBe(true);
      expect(mockedApi.remove).toHaveBeenCalledWith('a');
      expect(mockedApi.getAll).toHaveBeenCalledTimes(1);
    });

    it('captures a 409 (still referenced by ideas) error and does not refetch', async () => {
      mockedApi.remove.mockRejectedValueOnce({
        response: { data: { error: 'Cannot delete a department that still has ideas' } },
      });
      const store = useDepartmentsStore();

      const ok = await store.remove('a');

      expect(ok).toBe(false);
      expect(store.error).toBe('Cannot delete a department that still has ideas');
      expect(mockedApi.getAll).not.toHaveBeenCalled();
    });
  });
});
