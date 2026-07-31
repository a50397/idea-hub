import client from './client';
import type { AppOptions } from '../types';

export const optionsApi = {
  // Consolidated runtime UI flags for the authenticated app. Available to ANY
  // logged-in user; returns only booleans (no admin configuration). The pre-login
  // page uses authApi.getConfig() (ssoEnabled) instead.
  get: async (): Promise<AppOptions> => {
    const response = await client.get('/options');
    return response.data;
  },
};
