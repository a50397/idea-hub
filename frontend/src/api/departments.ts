import client from './client';
import type { Department } from '../types';

export const departmentsApi = {
  getAll: async (): Promise<Department[]> => {
    const response = await client.get('/departments');
    return response.data;
  },

  create: async (name: string): Promise<Department> => {
    const response = await client.post('/departments', { name });
    return response.data;
  },

  rename: async (id: string, name: string): Promise<Department> => {
    const response = await client.patch(`/departments/${id}`, { name });
    return response.data;
  },

  // ids must be an exact permutation of every current department id; the server
  // returns the full, reordered list (including _count).
  reorder: async (ids: string[]): Promise<Department[]> => {
    const response = await client.patch('/departments/reorder', { ids });
    return response.data;
  },

  remove: async (id: string): Promise<{ message: string }> => {
    const response = await client.delete(`/departments/${id}`);
    return response.data;
  },
};
