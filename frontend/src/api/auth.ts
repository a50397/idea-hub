import client from './client';
import type { User } from '../types';

export const authApi = {
  login: async (email: string, password: string): Promise<User> => {
    const response = await client.post('/auth/login', { email, password });
    return response.data;
  },

  logout: async (): Promise<void> => {
    await client.post('/auth/logout');
  },

  getCurrentUser: async (): Promise<User> => {
    const response = await client.get('/auth/me');
    return response.data;
  },
};
