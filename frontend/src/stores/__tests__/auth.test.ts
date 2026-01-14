import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from '../auth';
import { authApi } from '@/api/auth';
import { Role } from '@/types';

// Mock the auth API
vi.mock('@/api/auth', () => ({
  authApi: {
    login: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(),
  },
}));

describe('Auth Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have null user initially', () => {
      const store = useAuthStore();
      expect(store.user).toBeNull();
    });

    it('should not be loading initially', () => {
      const store = useAuthStore();
      expect(store.loading).toBe(false);
    });

    it('should have no error initially', () => {
      const store = useAuthStore();
      expect(store.error).toBeNull();
    });

    it('should not be authenticated initially', () => {
      const store = useAuthStore();
      expect(store.isAuthenticated).toBe(false);
    });
  });

  describe('login', () => {
    it('should login successfully and set user', async () => {
      const mockUser = {
        id: '1',
        name: 'Test User',
        email: 'test@example.com',
        role: Role.USER,
      };

      vi.mocked(authApi.login).mockResolvedValue(mockUser);

      const store = useAuthStore();
      const result = await store.login('test@example.com', 'password');

      expect(result).toBe(true);
      expect(store.user).toEqual(mockUser);
      expect(store.error).toBeNull();
      expect(authApi.login).toHaveBeenCalledWith('test@example.com', 'password');
    });

    it('should handle login failure', async () => {
      const errorMessage = 'Invalid credentials';
      vi.mocked(authApi.login).mockRejectedValue({
        response: { data: { error: errorMessage } },
      });

      const store = useAuthStore();
      const result = await store.login('test@example.com', 'wrong');

      expect(result).toBe(false);
      expect(store.user).toBeNull();
      expect(store.error).toBe(errorMessage);
    });

    it('should set loading state during login', async () => {
      let loadingDuringCall = false;

      vi.mocked(authApi.login).mockImplementation(async () => {
        const store = useAuthStore();
        loadingDuringCall = store.loading;
        return {
          id: '1',
          name: 'Test',
          email: 'test@example.com',
          role: Role.USER,
        };
      });

      const store = useAuthStore();
      await store.login('test@example.com', 'password');

      expect(loadingDuringCall).toBe(true);
      expect(store.loading).toBe(false);
    });
  });

  describe('logout', () => {
    it('should logout and clear user', async () => {
      vi.mocked(authApi.logout).mockResolvedValue();

      const store = useAuthStore();
      store.user = {
        id: '1',
        name: 'Test User',
        email: 'test@example.com',
        role: Role.USER,
      };

      await store.logout();

      expect(store.user).toBeNull();
      expect(authApi.logout).toHaveBeenCalled();
    });
  });

  describe('checkAuth', () => {
    it('should check auth and set user if authenticated', async () => {
      const mockUser = {
        id: '1',
        name: 'Test User',
        email: 'test@example.com',
        role: Role.USER,
      };

      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser);

      const store = useAuthStore();
      const result = await store.checkAuth();

      expect(result).toBe(true);
      expect(store.user).toEqual(mockUser);
    });

    it('should return false if not authenticated', async () => {
      vi.mocked(authApi.getCurrentUser).mockRejectedValue(new Error('Not authenticated'));

      const store = useAuthStore();
      const result = await store.checkAuth();

      expect(result).toBe(false);
      expect(store.user).toBeNull();
    });
  });

  describe('computed properties', () => {
    it('should correctly compute isAdmin', () => {
      const store = useAuthStore();
      
      store.user = {
        id: '1',
        name: 'Admin',
        email: 'admin@example.com',
        role: Role.ADMIN,
      };

      expect(store.isAdmin).toBe(true);
      expect(store.isPowerUser).toBe(true);
    });

    it('should correctly compute isPowerUser', () => {
      const store = useAuthStore();
      
      store.user = {
        id: '1',
        name: 'Power User',
        email: 'power@example.com',
        role: Role.POWER_USER,
      };

      expect(store.isAdmin).toBe(false);
      expect(store.isPowerUser).toBe(true);
    });

    it('should correctly compute regular user', () => {
      const store = useAuthStore();
      
      store.user = {
        id: '1',
        name: 'User',
        email: 'user@example.com',
        role: Role.USER,
      };

      expect(store.isAdmin).toBe(false);
      expect(store.isPowerUser).toBe(false);
      expect(store.isUser).toBe(true);
    });
  });
});
