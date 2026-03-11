import axios from 'axios';

const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001',
  withCredentials: true,
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
