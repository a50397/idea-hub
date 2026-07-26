import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';
import MainLayout from '../layouts/MainLayout.vue';
import { useAuthStore } from '../stores/auth';
import { Role } from '../types';
import { createTestI18n, createTestVuetify, findByText } from './helpers';

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

const Dummy = { template: '<div />' };

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'Login', component: Dummy },
      { path: '/', name: 'Dashboard', component: Dummy },
      { path: '/submit', name: 'SubmitIdea', component: Dummy },
      { path: '/my-ideas', name: 'MyIdeas', component: Dummy },
      { path: '/approved', name: 'ApprovedIdeas', component: Dummy },
      { path: '/in-progress', name: 'InProgressIdeas', component: Dummy },
      { path: '/completed', name: 'CompletedIdeas', component: Dummy },
      { path: '/review', name: 'ReviewQueue', component: Dummy },
      { path: '/reports', name: 'Reports', component: Dummy },
      { path: '/change-password', name: 'ChangePassword', component: Dummy },
      { path: '/users', name: 'Users', component: Dummy },
      { path: '/departments', name: 'Departments', component: Dummy },
    ],
  });
}

async function mountLayout(
  role: Role | null,
  locale = 'en',
  authProvider?: 'LOCAL' | 'SSO' | null
) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore();
  if (role) auth.user = { id: 'u1', name: 'Nav Tester', email: 'nav@x.com', role, authProvider };

  const router = makeRouter();
  router.push('/');
  await router.isReady();

  const i18n = createTestI18n(locale);
  const wrapper = mount(MainLayout, {
    global: { plugins: [createTestVuetify(), i18n, pinia, router] },
  });
  await flushPromises();
  return { wrapper, router, auth, i18n };
}

function navTitles(wrapper: any): string[] {
  return wrapper.findAll('.v-list-item-title').map((t: any) => t.text().trim());
}

describe('MainLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAuth.logout.mockResolvedValue({ message: 'Logged out successfully' });
  });

  it('always shows the core nav items and the current user info', async () => {
    const { wrapper } = await mountLayout(Role.USER);
    const titles = navTitles(wrapper);
    for (const label of [
      'Dashboard',
      'Submit Idea',
      'My Ideas',
      'Approved',
      'In Progress',
      'Completed',
      'Reports',
      'Change Password',
    ]) {
      expect(titles).toContain(label);
    }
    expect(wrapper.text()).toContain('Nav Tester');
    expect(wrapper.text()).toContain('nav@x.com');
  });

  const roleCases = [
    { role: Role.USER, reviewQueue: false, users: false, departments: false },
    { role: Role.POWER_USER, reviewQueue: true, users: false, departments: false },
    { role: Role.ADMIN, reviewQueue: true, users: true, departments: true },
  ] as const;

  describe.each(roleCases)('role-based nav for $role', ({ role, reviewQueue, users, departments }) => {
    it(`${reviewQueue ? 'shows' : 'hides'} Review Queue, ${users ? 'shows' : 'hides'} Users, ${departments ? 'shows' : 'hides'} Departments`, async () => {
      const { wrapper } = await mountLayout(role);
      const titles = navTitles(wrapper);
      expect(titles.includes('Review Queue')).toBe(reviewQueue);
      expect(titles.includes('Users')).toBe(users);
      expect(titles.includes('Departments')).toBe(departments);
    });
  });

  describe('locale toggle', () => {
    it('switches the i18n locale to SK and re-translates nav labels', async () => {
      const { wrapper, i18n } = await mountLayout(Role.USER, 'en');
      expect(navTitles(wrapper)).toContain('Dashboard');

      await findByText(wrapper, '.v-btn', 'SK')!.trigger('click');
      await flushPromises();

      expect((i18n.global.locale as any).value).toBe('sk');
      expect(localStorage.getItem('locale')).toBe('sk');
      expect(navTitles(wrapper)).toContain('Prehľad');
    });

    it('switches back to EN', async () => {
      const { wrapper, i18n } = await mountLayout(Role.USER, 'sk');
      expect(navTitles(wrapper)).toContain('Prehľad');

      await findByText(wrapper, '.v-btn', 'EN')!.trigger('click');
      await flushPromises();

      expect((i18n.global.locale as any).value).toBe('en');
      expect(navTitles(wrapper)).toContain('Dashboard');
    });
  });

  describe('logout', () => {
    it('calls the store logout and navigates to Login', async () => {
      const { wrapper, router, auth } = await mountLayout(Role.USER);
      const pushSpy = vi.spyOn(router, 'push').mockResolvedValue(undefined as any);

      await findByText(wrapper, '.v-btn', 'Logout')!.trigger('click');
      await flushPromises();

      expect(mockedAuth.logout).toHaveBeenCalledTimes(1);
      expect(auth.user).toBeNull();
      expect(pushSpy).toHaveBeenCalledWith({ name: 'Login' });
    });

    it.each([
      { authProvider: undefined, shown: true },
      { authProvider: 'LOCAL' as const, shown: true },
      { authProvider: null, shown: true },
      { authProvider: 'SSO' as const, shown: false },
    ])(
      'authProvider=$authProvider → logout button and Change Password nav shown=$shown',
      async ({ authProvider, shown }) => {
        const { wrapper } = await mountLayout(Role.USER, 'en', authProvider);
        const btn = findByText(wrapper, '.v-btn', 'Logout');
        expect(Boolean(btn)).toBe(shown);
        expect(navTitles(wrapper).includes('Change Password')).toBe(shown);
      }
    );
  });
});
