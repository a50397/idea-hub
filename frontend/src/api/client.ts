import axios from 'axios';
import { DEFAULT_TIMEOUT_MS } from './timeouts';

// The router guard awaits /auth/me before calling next(), so an unbounded request
// there leaves <router-view> empty and the page blank until a manual refresh. The
// few routes that wait on an external service opt into EXTERNAL_CALL_TIMEOUT_MS
// explicitly at the call site.
const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001',
  withCredentials: true,
  timeout: DEFAULT_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  },
});

// Response interceptor — handle session expiry.
// For /auth/me, the router guard handles the redirect, so skip here.
// For all other 401s (session expired mid-use), do a full redirect.
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const isAuthCheck = error.config?.url?.includes('/auth/me');
      if (!isAuthCheck) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default client;
