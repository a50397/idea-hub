import client from './client';
import type { User, AuthConfig, LogoutResponse } from '../types';

export const authApi = {
  getConfig: async (): Promise<AuthConfig> => {
    const response = await client.get('/auth/config');
    return response.data;
  },

  login: async (email: string, password: string): Promise<User> => {
    const response = await client.post('/auth/login', { email, password });
    return response.data;
  },

  logout: async (): Promise<LogoutResponse> => {
    const response = await client.post('/auth/logout');
    return response.data;
  },

  getCurrentUser: async (): Promise<User> => {
    const response = await client.get('/auth/me');
    return response.data;
  },

  changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    await client.post('/auth/change-password', { currentPassword, newPassword });
  },
};
