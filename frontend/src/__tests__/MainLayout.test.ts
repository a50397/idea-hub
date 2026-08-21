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

// MainLayout reads the SSO logout-button visibility flag from the authenticated
// /api/options (via the options store) on mount.
vi.mock('../api/options', () => ({
  optionsApi: {
    get: vi.fn(),
  },
}));

import { authApi } from '../api/auth';
import { optionsApi } from '../api/options';
const mockedAuth = vi.mocked(authApi);
const mockedOptions = vi.mocked(optionsApi);

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
      { path: '/mail-settings', name: 'MailSettings', component: Dummy },
      { path: '/webex-settings', name: 'WebexSettings', component: Dummy },
      { path: '/jira-settings', name: 'JiraSettings', component: Dummy },
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
    // MainLayout fetches /api/options on mount for the SSO logout-visibility flag;
    // default: flag false → logout stays hidden for SSO users.
    mockedOptions.get.mockResolvedValue({ mailEnabled: false, webexEnabled: false, jiraEnabled: false, ssoShowLogout: false });
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
    { role: Role.USER, reviewQueue: false, users: false, departments: false, adminSettings: false },
    { role: Role.POWER_USER, reviewQueue: true, users: false, departments: false, adminSettings: false },
    { role: Role.ADMIN, reviewQueue: true, users: true, departments: true, adminSettings: true },
  ] as const;

  describe.each(roleCases)('role-based nav for $role', ({ role, reviewQueue, users, departments, adminSettings }) => {
    it(`${reviewQueue ? 'shows' : 'hides'} Review Queue, ${users ? 'shows' : 'hides'} Users, ${departments ? 'shows' : 'hides'} Departments, ${adminSettings ? 'shows' : 'hides'} Email + Webex + Jira Settings`, async () => {
      const { wrapper } = await mountLayout(role);
      const titles = navTitles(wrapper);
      expect(titles.includes('Review Queue')).toBe(reviewQueue);
      expect(titles.includes('Users')).toBe(users);
      expect(titles.includes('Departments')).toBe(departments);
      // The three admin-only notification/execution-channel settings pages appear together.
      expect(titles.includes('Email Settings')).toBe(adminSettings);
      expect(titles.includes('Webex Settings')).toBe(adminSettings);
      expect(titles.includes('Jira Settings')).toBe(adminSettings);
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

    it('SSO user with ssoShowLogout: logout button returns, Change Password stays hidden', async () => {
      mockedOptions.get.mockResolvedValue({ mailEnabled: false, webexEnabled: false, jiraEnabled: false, ssoShowLogout: true });
      const { wrapper } = await mountLayout(Role.USER, 'en', 'SSO');
      expect(Boolean(findByText(wrapper, '.v-btn', 'Logout'))).toBe(true);
      expect(navTitles(wrapper).includes('Change Password')).toBe(false);
    });
  });

  // The admin-only banner for a failing Jira background sync. The server sends
  // `jiraSyncFailing` to ADMIN sessions only, so the non-admin cases mirror what
  // the API actually returns for those roles: no such key at all.
  describe('Jira sync failure banner', () => {
    const BANNER_TEXT = 'Jira synchronization is failing';

    function optionsResponse(jiraSyncFailing?: boolean) {
      return {
        mailEnabled: false,
        webexEnabled: false,
        jiraEnabled: true,
        ssoShowLogout: false,
        ...(jiraSyncFailing === undefined ? {} : { jiraSyncFailing }),
      };
    }

    function banner(wrapper: any) {
      return wrapper.findComponent({ name: 'VAlert' });
    }

    it('shows a warning banner linking to the Jira settings for an ADMIN when the sync is failing', async () => {
      mockedOptions.get.mockResolvedValue(optionsResponse(true));
      const { wrapper } = await mountLayout(Role.ADMIN);

      expect(banner(wrapper).exists()).toBe(true);
      expect(wrapper.text()).toContain(BANNER_TEXT);
      // The link lives INSIDE the banner (the nav drawer has its own, unrelated
      // link to the same route).
      const link = banner(wrapper).find('a[href="/jira-settings"]');
      expect(link.exists()).toBe(true);
      expect(link.text()).toBe('Open Jira settings');
    });

    it('shows nothing for an ADMIN while the sync is healthy', async () => {
      mockedOptions.get.mockResolvedValue(optionsResponse(false));
      const { wrapper } = await mountLayout(Role.ADMIN);

      expect(banner(wrapper).exists()).toBe(false);
      expect(wrapper.text()).not.toContain(BANNER_TEXT);
    });

    it.each([Role.USER, Role.POWER_USER])(
      'never renders for a %s (the flag is not even sent to them)',
      async (role) => {
        mockedOptions.get.mockResolvedValue(optionsResponse());
        const { wrapper } = await mountLayout(role);

        expect(banner(wrapper).exists()).toBe(false);
      }
    );

    // Belt and braces: even a response that wrongly carried the flag must not put
    // an actionable admin warning in front of a non-admin.
    it('stays hidden for a non-admin even if the flag arrives anyway', async () => {
      mockedOptions.get.mockResolvedValue(optionsResponse(true));
      const { wrapper } = await mountLayout(Role.USER);

      expect(banner(wrapper).exists()).toBe(false);
    });

    it('stays dismissed for the rest of the session once closed', async () => {
      mockedOptions.get.mockResolvedValue(optionsResponse(true));
      const { wrapper } = await mountLayout(Role.ADMIN);
      expect(banner(wrapper).exists()).toBe(true);

      banner(wrapper).vm.$emit('click:close');
      await flushPromises();

      expect(banner(wrapper).exists()).toBe(false);
      expect(wrapper.text()).not.toContain(BANNER_TEXT);
    });

    it('is localized', async () => {
      mockedOptions.get.mockResolvedValue(optionsResponse(true));
      const { wrapper } = await mountLayout(Role.ADMIN, 'sk');

      expect(wrapper.text()).toContain('Synchronizácia s Jirou zlyháva');
    });
  });
});
