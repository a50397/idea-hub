import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { Role } from '../types';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('../pages/LoginPage.vue'),
      meta: { requiresAuth: false },
    },
    {
      path: '/',
      component: () => import('../layouts/MainLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          name: 'Dashboard',
          component: () => import('../pages/DashboardPage.vue'),
        },
        {
          path: 'submit',
          name: 'SubmitIdea',
          component: () => import('../pages/SubmitIdeaPage.vue'),
        },
        {
          path: 'my-ideas',
          name: 'MyIdeas',
          component: () => import('../pages/MyIdeasPage.vue'),
        },
        {
          path: 'ideas/:id',
          name: 'IdeaDetail',
          component: () => import('../pages/IdeaDetailPage.vue'),
        },
        {
          path: 'approved',
          name: 'ApprovedIdeas',
          component: () => import('../pages/ApprovedIdeasPage.vue'),
        },
        {
          path: 'in-progress',
          name: 'InProgressIdeas',
          component: () => import('../pages/InProgressIdeasPage.vue'),
        },
        {
          path: 'completed',
          name: 'CompletedIdeas',
          component: () => import('../pages/CompletedIdeasPage.vue'),
        },
        {
          path: 'review',
          name: 'ReviewQueue',
          component: () => import('../pages/ReviewQueuePage.vue'),
          meta: { requiresPowerUser: true },
        },
        {
          path: 'reports',
          name: 'Reports',
          component: () => import('../pages/ReportsPage.vue'),
        },
        {
          path: 'change-password',
          name: 'ChangePassword',
          component: () => import('../pages/ChangePasswordPage.vue'),
        },
        {
          path: 'users',
          name: 'Users',
          component: () => import('../pages/UsersPage.vue'),
          meta: { requiresAdmin: true },
        },
        {
          path: 'departments',
          name: 'Departments',
          component: () => import('../pages/DepartmentsPage.vue'),
          meta: { requiresAdmin: true },
        },
        {
          path: 'mail-settings',
          name: 'MailSettings',
          component: () => import('../pages/MailSettingsPage.vue'),
          meta: { requiresAdmin: true },
        },
        {
          path: 'webex-settings',
          name: 'WebexSettings',
          component: () => import('../pages/WebexSettingsPage.vue'),
          meta: { requiresAdmin: true },
        },
        {
          path: 'jira-settings',
          name: 'JiraSettings',
          component: () => import('../pages/JiraSettingsPage.vue'),
          meta: { requiresAdmin: true },
        },
      ],
    },
  ],
});

router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore();

  if (to.meta.requiresAuth !== false) {
    if (!authStore.isAuthenticated) {
      await authStore.checkAuth();
    }

    if (!authStore.isAuthenticated) {
      return next({ name: 'Login' });
    }

    if (to.meta.requiresAdmin && !authStore.isAdmin) {
      return next({ name: 'Dashboard' });
    }

    if (to.meta.requiresPowerUser && !authStore.isPowerUser) {
      return next({ name: 'Dashboard' });
    }
  }

  if (to.name === 'Login' && authStore.isAuthenticated) {
    return next({ name: 'Dashboard' });
  }

  next();
});

// Every route is a lazy import. A chunk that fails to load rejects the navigation
// and leaves <router-view> empty — a blank page, no error shown. Reloading fetches
// the current manifest and fixes it, so do that automatically, but only once per
// tab: a genuinely missing chunk would otherwise loop. afterEach re-arms the guard
// once a navigation succeeds.
const RELOAD_ATTEMPTED_KEY = 'ideahub:chunk-reload-attempted';

router.onError((err, to) => {
  console.error('Router navigation failed:', to?.fullPath, err);

  const message = String((err as Error)?.message ?? err);
  const isChunkLoadFailure =
    /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch/i.test(
      message
    );

  if (isChunkLoadFailure && !sessionStorage.getItem(RELOAD_ATTEMPTED_KEY)) {
    sessionStorage.setItem(RELOAD_ATTEMPTED_KEY, '1');
    window.location.reload();
  }
});

router.afterEach(() => {
  sessionStorage.removeItem(RELOAD_ATTEMPTED_KEY);
});

export default router;
