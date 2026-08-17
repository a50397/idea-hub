import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import CompletedIdeasPage from '../pages/CompletedIdeasPage.vue';
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

// An idea submitted by somebody else: a basic USER must still see it.
function makeIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: 'idea-1',
    title: 'Someone else\'s completed idea',
    description: 'Some description text',
    benefits: 'Some benefits',
    effort: Effort.LESS_THAN_ONE_DAY,
    status: IdeaStatus.DONE,
    tags: [],
    submitterId: 'u2',
    submitter: { id: 'u2', name: 'Other Person', email: 'other@x.com', role: Role.USER },
    submittedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// A full server page of distinct ideas, for the truncation boundary.
const fullPage = () =>
  Array.from({ length: MAX_PAGE_LIMIT }, (_, i) => makeIdea({ id: `idea-${i}`, title: `Idea ${i}` }));

function mountPage() {
  return mount(CompletedIdeasPage, {
    global: { plugins: [createTestVuetify(), createTestI18n('en')] },
  });
}

describe('CompletedIdeasPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockedIdeas.getAll.mockResolvedValue(paginated([]));
    mockedDepartments.getAll.mockResolvedValue([
      { id: 'd1', name: 'General', order: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'd2', name: 'Marketing', order: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const auth = useAuthStore();
    auth.user = { id: 'u1', name: 'Me', email: 'me@x.com', role: Role.USER };
  });

  it('loads completed ideas org-wide for a basic USER (no submitterId) at the max page limit', async () => {
    mountPage();
    await flushPromises();

    expect(mockedIdeas.getAll).toHaveBeenCalledTimes(1);
    expect(mockedIdeas.getAll).toHaveBeenCalledWith({
      status: IdeaStatus.DONE,
      limit: MAX_PAGE_LIMIT,
      page: 1,
    });
    expect(mockedIdeas.getAll.mock.calls[0][0]).not.toHaveProperty('submitterId');
  });

  it('still sends no submitterId when a department filter is selected', async () => {
    const wrapper = mountPage();
    await flushPromises();
    mockedIdeas.getAll.mockClear();

    wrapper.findComponent({ name: 'VSelect' }).vm.$emit('update:modelValue', 'd2');
    await flushPromises();

    expect(mockedIdeas.getAll).toHaveBeenCalledWith({
      status: IdeaStatus.DONE,
      limit: MAX_PAGE_LIMIT,
      page: 1,
      departmentId: 'd2',
    });
    expect(mockedIdeas.getAll.mock.calls[0][0]).not.toHaveProperty('submitterId');
  });

  it('renders ideas submitted by other users', async () => {
    mockedIdeas.getAll.mockResolvedValue(
      paginated([makeIdea({ id: 'a', title: 'Idea from Other Person' })])
    );
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.findAllComponents({ name: 'IdeaCard' })).toHaveLength(1);
    expect(wrapper.text()).toContain('Idea from Other Person');
  });

  it('renders the pager when the matches span multiple pages', async () => {
    mockedIdeas.getAll.mockResolvedValue(paginated([makeIdea()], 250));
    const wrapper = mountPage();
    await flushPromises();

    const pager = wrapper.findComponent({ name: 'VPagination' });
    expect(pager.exists()).toBe(true);
    expect(pager.props('length')).toBe(3);
  });

  it('renders no pager when every match fits on one page', async () => {
    mockedIdeas.getAll.mockResolvedValue(paginated([makeIdea()]));
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.findComponent({ name: 'VPagination' }).exists()).toBe(false);
  });

  // Boundary: the pager must appear only when the server actually withheld rows,
  // i.e. at total = MAX_PAGE_LIMIT + 1, never at exactly a full page.
  it('renders no pager at exactly a full page (total = rows = MAX_PAGE_LIMIT)', async () => {
    mockedIdeas.getAll.mockResolvedValue(paginated(fullPage(), MAX_PAGE_LIMIT));
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.findComponent({ name: 'VPagination' }).exists()).toBe(false);
  });

  it('renders the pager one match past a full page (total = MAX_PAGE_LIMIT + 1)', async () => {
    mockedIdeas.getAll.mockResolvedValue(paginated(fullPage(), MAX_PAGE_LIMIT + 1));
    const wrapper = mountPage();
    await flushPromises();

    const pager = wrapper.findComponent({ name: 'VPagination' });
    expect(pager.exists()).toBe(true);
    expect(pager.props('length')).toBe(2);
  });

  it('fetches the selected page and resets to page 1 when a filter changes', async () => {
    mockedIdeas.getAll.mockResolvedValue(paginated(fullPage(), 250));
    const wrapper = mountPage();
    await flushPromises();
    mockedIdeas.getAll.mockClear();

    wrapper.findComponent({ name: 'VPagination' }).vm.$emit('update:modelValue', 2);
    await flushPromises();
    expect(mockedIdeas.getAll).toHaveBeenCalledWith({
      status: IdeaStatus.DONE,
      limit: MAX_PAGE_LIMIT,
      page: 2,
    });

    mockedIdeas.getAll.mockClear();
    wrapper.findComponent({ name: 'VSelect' }).vm.$emit('update:modelValue', 'd2');
    await flushPromises();
    expect(mockedIdeas.getAll).toHaveBeenCalledWith({
      status: IdeaStatus.DONE,
      limit: MAX_PAGE_LIMIT,
      page: 1,
      departmentId: 'd2',
    });
  });
});
