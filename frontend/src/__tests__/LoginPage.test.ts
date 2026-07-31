import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import LoginPage from '../pages/LoginPage.vue';
import { Role } from '../types';
import { createTestI18n, createTestVuetify, findByText } from './helpers';

// Hoisted mocks referenced inside vi.mock factories.
const { mockPush, routeRef } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  routeRef: { query: {} as Record<string, any> },
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useRoute: () => routeRef,
}));

vi.mock('../api/auth', () => ({
  authApi: {
    getConfig: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(),
    changePassword: vi.fn(),
  },
}));

vi.mock('../api/client', () => ({
  default: { defaults: { baseURL: 'http://localhost:3001' } },
}));

import { authApi } from '../api/auth';
const mockedAuth = vi.mocked(authApi);

function mountLogin() {
  return mount(LoginPage, {
    global: { plugins: [createTestVuetify(), createTestI18n('en')] },
  });
}

describe('LoginPage', () => {
  let assignSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    routeRef.query = {};
    // Default: SSO disabled unless a test overrides it.
    mockedAuth.getConfig.mockResolvedValue({ ssoEnabled: false });

    assignSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign: assignSpy, href: 'http://localhost/login' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the login form (email + password + login button)', async () => {
    const wrapper = mountLogin();
    await flushPromises();
    expect(wrapper.find('input[type="email"]').exists()).toBe(true);
    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    expect(findByText(wrapper, '.v-btn', 'Login')).toBeTruthy();
  });

  it('shows validation errors and does not call login on empty submit', async () => {
    const wrapper = mountLogin();
    await flushPromises();

    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('Email is required');
    expect(wrapper.text()).toContain('Password is required');
    expect(mockedAuth.login).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('calls store login and navigates to Dashboard on successful submit', async () => {
    mockedAuth.login.mockResolvedValueOnce({
      id: 'u1',
      name: 'Test User',
      email: 'user@x.com',
      role: Role.USER,
    });
    const wrapper = mountLogin();
    await flushPromises();

    await wrapper.find('input[type="email"]').setValue('user@x.com');
    await wrapper.find('input[type="password"]').setValue('secret123');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(mockedAuth.login).toHaveBeenCalledWith('user@x.com', 'secret123');
    expect(mockPush).toHaveBeenCalledWith({ name: 'Dashboard' });
  });

  it('does not navigate when login fails', async () => {
    mockedAuth.login.mockRejectedValueOnce({ response: { data: { error: 'Invalid credentials' } } });
    const wrapper = mountLogin();
    await flushPromises();

    await wrapper.find('input[type="email"]').setValue('bad@x.com');
    await wrapper.find('input[type="password"]').setValue('wrong');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(mockPush).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Invalid credentials');
  });

  describe('SSO disabled', () => {
    beforeEach(() => {
      mockedAuth.getConfig.mockResolvedValue({ ssoEnabled: false });
    });

    it('shows no SSO button and keeps the local form visible', async () => {
      const wrapper = mountLogin();
      await flushPromises();
      expect(findByText(wrapper, '.v-btn', 'Sign in with SSO')).toBeFalsy();
      expect(wrapper.find('input[type="email"]').exists()).toBe(true);
    });
  });

  describe('SSO enabled', () => {
    beforeEach(() => {
      mockedAuth.getConfig.mockResolvedValue({ ssoEnabled: true });
    });

    it('shows the SSO button and hides the local form until toggled', async () => {
      const wrapper = mountLogin();
      await flushPromises();

      expect(findByText(wrapper, '.v-btn', 'Sign in with SSO')).toBeTruthy();
      expect(wrapper.find('input[type="email"]').exists()).toBe(false);

      // Toggle reveals the local account form.
      const toggle = findByText(wrapper, '.v-btn', 'Use a local account (admin only)');
      expect(toggle).toBeTruthy();
      await toggle!.trigger('click');
      await flushPromises();
      expect(wrapper.find('input[type="email"]').exists()).toBe(true);
    });

    it('navigates the browser to the SSO login URL when clicked', async () => {
      const wrapper = mountLogin();
      await flushPromises();

      await findByText(wrapper, '.v-btn', 'Sign in with SSO')!.trigger('click');
      expect(assignSpy).toHaveBeenCalledWith('http://localhost:3001/auth/sso/login');
    });
  });

  describe('sso_failed query param', () => {
    it('shows the SSO failure alert with the i18n message', async () => {
      routeRef.query = { error: 'sso_failed' };
      const wrapper = mountLogin();
      await flushPromises();

      expect(wrapper.text()).toContain(
        'SSO sign-in failed. Please try again or use a local account.'
      );
      expect(wrapper.findComponent({ name: 'VAlert' }).exists()).toBe(true);
    });

    it('shows no SSO failure alert without the query param', async () => {
      routeRef.query = {};
      const wrapper = mountLogin();
      await flushPromises();
      expect(wrapper.text()).not.toContain('SSO sign-in failed');
    });
  });
});
