import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import ReviewQueuePage from '../pages/ReviewQueuePage.vue';
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
    approve: vi.fn(),
    reject: vi.fn(),
  },
}));

// The department filter select is populated by the departments store on mount.
vi.mock('../api/departments', () => ({
  departmentsApi: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    reorder: vi.fn(),
    remove: vi.fn(),
  },
}));

// The store imports authApi at module load; stub it so nothing touches the network.
vi.mock('../api/auth', () => ({
  authApi: {
    login: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(),
    getConfig: vi.fn(),
    changePassword: vi.fn(),
  },
}));

import { ideasApi } from '../api/ideas';
import { departmentsApi } from '../api/departments';
const mockedIdeas = vi.mocked(ideasApi);
const mockedDepartments = vi.mocked(departmentsApi);

function makeIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: 'idea-1',
    title: 'A pending idea',
    description: 'Some description text',
    benefits: 'Some benefits',
    effort: Effort.LESS_THAN_ONE_DAY,
    status: IdeaStatus.SUBMITTED,
    tags: [],
    submitterId: 'u2',
    submitter: { id: 'u2', name: 'Other Person', email: 'other@x.com', role: Role.USER },
    submittedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mountPage() {
  return mount(ReviewQueuePage, {
    global: { plugins: [createTestVuetify(), createTestI18n('en')] },
  });
}

describe('ReviewQueuePage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockedIdeas.getAll.mockResolvedValue(paginated([]));
    mockedDepartments.getAll.mockResolvedValue([
      { id: 'd1', name: 'General', order: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'd2', name: 'Marketing', order: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const auth = useAuthStore();
    auth.user = { id: 'u1', name: 'Power Pat', email: 'pat@x.com', role: Role.POWER_USER };
  });

  it('asks only for SUBMITTED ideas and never scopes the queue to the reviewer', async () => {
    mountPage();
    await flushPromises();

    expect(mockedIdeas.getAll).toHaveBeenCalledTimes(1);
    expect(mockedIdeas.getAll).toHaveBeenCalledWith({
      status: IdeaStatus.SUBMITTED,
      limit: MAX_PAGE_LIMIT,
      page: 1,
    });
    expect(mockedIdeas.getAll.mock.calls[0][0]).not.toHaveProperty('submitterId');
  });

  it('renders a card per idea from the { data, pagination } envelope', async () => {
    mockedIdeas.getAll.mockResolvedValue(
      paginated([
        makeIdea({ id: 'a', title: 'First pending idea' }),
        makeIdea({ id: 'b', title: 'Second pending idea' }),
      ])
    );
    const wrapper = mountPage();
    await flushPromises();

    // The page reads `.data` off the envelope; only those rows may be rendered.
    expect(wrapper.findAll('.v-card-title').map((t) => t.text())).toEqual([
      'First pending idea',
      'Second pending idea',
    ]);
    expect(wrapper.text()).toContain('Other Person');
  });

  it('shows the empty state when nothing is pending review', async () => {
    mockedIdeas.getAll.mockResolvedValue(paginated([]));
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('No ideas pending review.');
  });

  it('adds departmentId — and still no submitterId — when the department filter changes', async () => {
    const wrapper = mountPage();
    await flushPromises();
    mockedIdeas.getAll.mockClear();

    wrapper.findComponent({ name: 'VSelect' }).vm.$emit('update:modelValue', 'd2');
    await flushPromises();

    expect(mockedIdeas.getAll).toHaveBeenCalledWith({
      status: IdeaStatus.SUBMITTED,
      limit: MAX_PAGE_LIMIT,
      page: 1,
      departmentId: 'd2',
    });
    expect(mockedIdeas.getAll.mock.calls[0][0]).not.toHaveProperty('submitterId');
  });

  it('pages the queue when it spans multiple server pages', async () => {
    mockedIdeas.getAll.mockResolvedValue(paginated([makeIdea()], MAX_PAGE_LIMIT + 1));
    const wrapper = mountPage();
    await flushPromises();

    const pager = wrapper.findComponent({ name: 'VPagination' });
    expect(pager.exists()).toBe(true);
    expect(pager.props('length')).toBe(2);

    mockedIdeas.getAll.mockClear();
    pager.vm.$emit('update:modelValue', 2);
    await flushPromises();
    expect(mockedIdeas.getAll).toHaveBeenCalledWith({
      status: IdeaStatus.SUBMITTED,
      limit: MAX_PAGE_LIMIT,
      page: 2,
    });
  });

  it('renders no pager when the queue fits on one page', async () => {
    mockedIdeas.getAll.mockResolvedValue(paginated([makeIdea()], MAX_PAGE_LIMIT));
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.findComponent({ name: 'VPagination' }).exists()).toBe(false);
  });

  it('resets to page 1 when the department filter changes after paging', async () => {
    mockedIdeas.getAll.mockResolvedValue(paginated([makeIdea()], MAX_PAGE_LIMIT + 1));
    const wrapper = mountPage();
    await flushPromises();
    wrapper.findComponent({ name: 'VPagination' }).vm.$emit('update:modelValue', 2);
    await flushPromises();
    mockedIdeas.getAll.mockClear();

    wrapper.findComponent({ name: 'VSelect' }).vm.$emit('update:modelValue', 'd2');
    await flushPromises();
    expect(mockedIdeas.getAll).toHaveBeenCalledWith({
      status: IdeaStatus.SUBMITTED,
      limit: MAX_PAGE_LIMIT,
      page: 1,
      departmentId: 'd2',
    });
  });
});
