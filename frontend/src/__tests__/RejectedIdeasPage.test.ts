import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import RejectedIdeasPage from '../pages/RejectedIdeasPage.vue';
import { useAuthStore } from '../stores/auth';
import { IdeaStatus, Effort, Role, MAX_PAGE_LIMIT } from '../types';
import type { Idea } from '../types';
import { createTestI18n, createTestVuetify, paginated } from './helpers';

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useRoute: () => ({ query: {} }),
}));

vi.mock('../api/ideas', () => ({
  ideasApi: {
    getAll: vi.fn(),
  },
}));

vi.mock('../api/departments', () => ({
  departmentsApi: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    reorder: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('../api/auth', () => ({
  authApi: {
    login: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(),
    getConfig: vi.fn(),
    changePassword: vi.fn(),
  },
}));

vi.mock('../api/options', () => ({
  optionsApi: {
    get: vi.fn(),
  },
}));

import { ideasApi } from '../api/ideas';
import { departmentsApi } from '../api/departments';
import { optionsApi } from '../api/options';
const mockedIdeas = vi.mocked(ideasApi);
const mockedDepartments = vi.mocked(departmentsApi);
const mockedOptions = vi.mocked(optionsApi);

function makeIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: 'idea-1',
    title: 'Rejected idea',
    description: 'Some description',
    benefits: 'Some benefits',
    effort: Effort.LESS_THAN_ONE_DAY,
    status: IdeaStatus.REJECTED,
    tags: [],
    submitterId: 'u1',
    submitter: { id: 'u1', name: 'Test User', email: 'test@x.com', role: Role.USER },
    approverId: 'u2',
    approver: { id: 'u2', name: 'Reviewer', email: 'reviewer@x.com', role: Role.POWER_USER },
    submittedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makePage(ideas: Idea[] = [], total: number = ideas.length) {
  return paginated(ideas, total);
}

function mountPage() {
  const wrapper = mount(RejectedIdeasPage, {
    global: { plugins: [createPinia(), createTestI18n('en'), createTestVuetify()] },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

function signInAs(role: Role) {
  const auth = useAuthStore();
  auth.user = { id: 'actor1', name: 'Actor', email: 'actor@x.com', role };
}

let mountedWrappers: VueWrapper[] = [];

afterEach(() => {
  vi.clearAllMocks();
  mountedWrappers.forEach((w) => w.unmount());
  mountedWrappers = [];
});

describe('RejectedIdeasPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockedOptions.get.mockResolvedValue({ mailEnabled: false, webexEnabled: false, jiraEnabled: false, ssoShowLogout: false });
    mockedDepartments.getAll.mockResolvedValue([
      { id: 'd1', name: 'Department 1', order: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'd2', name: 'Department 2', order: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    signInAs(Role.USER);
  });

  describe('page title', () => {
    it('renders the page title', async () => {
      mockedIdeas.getAll.mockResolvedValue(makePage([]));
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.text()).toContain('Rejected');
    });
  });

  describe('loading state', () => {
    it('shows a loading spinner while loading', async () => {
      mockedIdeas.getAll.mockImplementation(() => new Promise(() => {}));
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.findComponent({ name: 'VProgressCircular' }).exists()).toBe(true);
    });
  });

  describe('idea list', () => {
    it('displays rejected ideas', async () => {
      const ideas = [makeIdea({ id: 'i1', title: 'First rejected' }), makeIdea({ id: 'i2', title: 'Second rejected' })];
      mockedIdeas.getAll.mockResolvedValue(makePage(ideas));
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.findAllComponents({ name: 'IdeaCard' })).toHaveLength(2);
      expect(wrapper.text()).toContain('First rejected');
      expect(wrapper.text()).toContain('Second rejected');
    });

    it('shows an info message when no rejected ideas exist', async () => {
      mockedIdeas.getAll.mockResolvedValue(makePage([]));
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.findComponent({ name: 'VAlert' }).exists()).toBe(true);
    });
  });

  describe('department filter', () => {
    it('renders a department filter select', async () => {
      mockedIdeas.getAll.mockResolvedValue(makePage([]));
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.findComponent({ name: 'VSelect' }).exists()).toBe(true);
    });
  });

  describe('API call', () => {
    it('fetches rejected ideas with REJECTED status filter', async () => {
      mockedIdeas.getAll.mockResolvedValue(makePage([]));
      mountPage();
      await flushPromises();

      expect(mockedIdeas.getAll).toHaveBeenCalledWith(
        expect.objectContaining({
          status: IdeaStatus.REJECTED,
          limit: MAX_PAGE_LIMIT,
          page: 1,
        })
      );
    });

    it('filters by department when selected', async () => {
      mockedIdeas.getAll.mockResolvedValue(makePage([]));
      const wrapper = mountPage();
      await flushPromises();
      mockedIdeas.getAll.mockClear();

      wrapper.findComponent({ name: 'VSelect' }).vm.$emit('update:modelValue', 'd2');
      await flushPromises();

      expect(mockedIdeas.getAll).toHaveBeenCalledWith(
        expect.objectContaining({
          status: IdeaStatus.REJECTED,
          departmentId: 'd2',
        })
      );
    });
  });

  describe('navigation', () => {
    it('navigates to idea detail when view is emitted', async () => {
      const idea = makeIdea({ id: 'idea-123' });
      mockedIdeas.getAll.mockResolvedValue(makePage([idea]));
      const wrapper = mountPage();
      await flushPromises();

      const card = wrapper.findComponent({ name: 'IdeaCard' });
      card.vm.$emit('view', idea.id);
      await flushPromises();

      expect(mockPush).toHaveBeenCalledWith({ name: 'IdeaDetail', params: { id: 'idea-123' } });
    });
  });

  describe('pagination', () => {
    it('renders the pager when matches span multiple pages', async () => {
      mockedIdeas.getAll.mockResolvedValue(makePage([], 250));
      const wrapper = mountPage();
      await flushPromises();

      const pager = wrapper.findComponent({ name: 'VPagination' });
      expect(pager.exists()).toBe(true);
      expect(pager.props('length')).toBe(3);
    });

    it('does not render the pager when all matches fit on one page', async () => {
      mockedIdeas.getAll.mockResolvedValue(makePage([makeIdea()]));
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.findComponent({ name: 'VPagination' }).exists()).toBe(false);
    });
  });
});
