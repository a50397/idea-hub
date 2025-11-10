import client from './client';
import type { UserWithCounts, CreateUserInput, UpdateUserInput } from '../types';

export const usersApi = {
  getAll: async (): Promise<UserWithCounts[]> => {
    const response = await client.get('/users');
    return response.data;
  },

  getOne: async (id: string): Promise<UserWithCounts> => {
    const response = await client.get(`/users/${id}`);
    return response.data;
  },

  create: async (data: CreateUserInput): Promise<UserWithCounts> => {
    const response = await client.post('/users', data);
    return response.data;
  },

  update: async (id: string, data: UpdateUserInput): Promise<UserWithCounts> => {
    const response = await client.patch(`/users/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await client.delete(`/users/${id}`);
  },
};
