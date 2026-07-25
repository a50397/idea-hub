import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from '../stores/auth';
import { Role } from '../types';
import type { User } from '../types';

// Replace the real network layer; the store must never hit axios.
vi.mock('../api/auth', () => ({
  authApi: {
    login: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(),
    getConfig: vi.fn(),
    changePassword: vi.fn(),
  },
}));

import { authApi } from '../api/auth';

const mockedAuth = vi.mocked(authApi);

function makeUser(role: Role): User {
  return {
    id: 'u1',
    name: 'Test User',
    email: 'test@x.com',
    role,
  };
}

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('login', () => {
    it('sets user, clears error and returns true on success', async () => {
      const user = makeUser(Role.USER);
      mockedAuth.login.mockResolvedValueOnce(user);
      const store = useAuthStore();

      const result = await store.login('test@x.com', 'secret');

      expect(result).toBe(true);
      expect(mockedAuth.login).toHaveBeenCalledWith('test@x.com', 'secret');
      expect(store.user).toEqual(user);
      expect(store.error).toBeNull();
      expect(store.loading).toBe(false);
    });

    it('sets the server error message and leaves user null on failure', async () => {
      mockedAuth.login.mockRejectedValueOnce({ response: { data: { error: 'Invalid credentials' } } });
      const store = useAuthStore();

      const result = await store.login('bad@x.com', 'nope');

      expect(result).toBe(false);
      expect(store.user).toBeNull();
      expect(store.error).toBe('Invalid credentials');
      expect(store.loading).toBe(false);
    });

    it('falls back to a generic error message when the server sends none', async () => {
      mockedAuth.login.mockRejectedValueOnce(new Error('network down'));
      const store = useAuthStore();

      const result = await store.login('a@x.com', 'p');

      expect(result).toBe(false);
      expect(store.error).toBe('Login failed');
      expect(store.user).toBeNull();
    });

    it('resets a previous error on a subsequent successful login', async () => {
      const store = useAuthStore();
      mockedAuth.login.mockRejectedValueOnce({ response: { data: { error: 'Invalid credentials' } } });
      await store.login('bad@x.com', 'nope');
      expect(store.error).toBe('Invalid credentials');

      mockedAuth.login.mockResolvedValueOnce(makeUser(Role.ADMIN));
      await store.login('admin@x.com', 'ok');
      expect(store.error).toBeNull();
      expect(store.user?.role).toBe(Role.ADMIN);
    });
  });

  describe('logout', () => {
    it('clears the user after calling the api and reports no redirect for a local logout', async () => {
      mockedAuth.login.mockResolvedValueOnce(makeUser(Role.USER));
      mockedAuth.logout.mockResolvedValueOnce({ message: 'Logged out successfully' });
      const store = useAuthStore();
      await store.login('test@x.com', 'secret');
      expect(store.user).not.toBeNull();

      const redirected = await store.logout();

      expect(redirected).toBe(false);
      expect(mockedAuth.logout).toHaveBeenCalledTimes(1);
      expect(store.user).toBeNull();
      expect(store.isAuthenticated).toBe(false);
    });

    it('swallows logout api errors and still finishes loading', async () => {
      mockedAuth.logout.mockRejectedValueOnce(new Error('boom'));
      const store = useAuthStore();
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const redirected = await store.logout();

      expect(redirected).toBe(false);
      expect(store.loading).toBe(false);
      spy.mockRestore();
    });

    describe('SSO RP-initiated logout', () => {
      let assignedHrefs: string[];
      let originalLocation: Location;

      beforeEach(() => {
        assignedHrefs = [];
        originalLocation = window.location;
        // Observe window.location.href assignments without a real navigation,
        // mirroring client.interceptor.test.ts.
        Object.defineProperty(window, 'location', {
          configurable: true,
          value: {
            get href() {
              return 'http://localhost/current';
            },
            set href(v: string) {
              assignedHrefs.push(v);
            },
          },
        });
      });

      afterEach(() => {
        Object.defineProperty(window, 'location', {
          configurable: true,
          value: originalLocation,
        });
      });

      it('full-page navigates to the IdP end-session URL, clears the user, and returns true', async () => {
        mockedAuth.login.mockResolvedValueOnce(makeUser(Role.USER));
        const endSessionUrl =
          'https://idp.example/endsession?id_token_hint=abc&post_logout_redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Flogin';
        mockedAuth.logout.mockResolvedValueOnce({
          message: 'Logged out successfully',
          redirectTo: endSessionUrl,
        });
        const store = useAuthStore();
        await store.login('test@x.com', 'secret');

        const redirected = await store.logout();

        expect(redirected).toBe(true);
        expect(assignedHrefs).toEqual([endSessionUrl]);
        expect(store.user).toBeNull();
        expect(store.isAuthenticated).toBe(false);
        expect(store.loading).toBe(false);
      });

      it('does not navigate when the server returns no redirectTo', async () => {
        mockedAuth.logout.mockResolvedValueOnce({ message: 'Logged out successfully' });
        const store = useAuthStore();

        const redirected = await store.logout();

        expect(redirected).toBe(false);
        expect(assignedHrefs).toEqual([]);
        expect(store.user).toBeNull();
      });
    });
  });

  describe('checkAuth', () => {
    it('populates the user from getCurrentUser and returns true', async () => {
      const user = makeUser(Role.POWER_USER);
      mockedAuth.getCurrentUser.mockResolvedValueOnce(user);
      const store = useAuthStore();

      const result = await store.checkAuth();

      expect(result).toBe(true);
      expect(store.user).toEqual(user);
      expect(store.loading).toBe(false);
    });

    it('clears the user and returns false when not authenticated', async () => {
      mockedAuth.getCurrentUser.mockRejectedValueOnce({ response: { status: 401 } });
      const store = useAuthStore();

      const result = await store.checkAuth();

      expect(result).toBe(false);
      expect(store.user).toBeNull();
      expect(store.loading).toBe(false);
    });
  });

  describe('role computeds', () => {
    const cases = [
      {
        role: Role.USER,
        isAuthenticated: true,
        isUser: true,
        isPowerUser: false,
        isAdmin: false,
      },
      {
        role: Role.POWER_USER,
        isAuthenticated: true,
        isUser: true,
        isPowerUser: true,
        isAdmin: false,
      },
      {
        role: Role.ADMIN,
        isAuthenticated: true,
        isUser: true,
        isPowerUser: true,
        isAdmin: true,
      },
    ] as const;

    describe.each(cases)('as %s', (c) => {
      it(`resolves the role computeds for ${c.role}`, async () => {
        mockedAuth.getCurrentUser.mockResolvedValueOnce(makeUser(c.role));
        const store = useAuthStore();
        await store.checkAuth();

        expect(store.isAuthenticated).toBe(c.isAuthenticated);
        expect(store.isUser).toBe(c.isUser);
        expect(store.isPowerUser).toBe(c.isPowerUser);
        expect(store.isAdmin).toBe(c.isAdmin);
      });
    });

    it('reports every computed as false when unauthenticated', () => {
      const store = useAuthStore();
      expect(store.user).toBeNull();
      expect(store.isAuthenticated).toBe(false);
      expect(store.isUser).toBe(false);
      expect(store.isPowerUser).toBe(false);
      expect(store.isAdmin).toBe(false);
    });
  });
});
