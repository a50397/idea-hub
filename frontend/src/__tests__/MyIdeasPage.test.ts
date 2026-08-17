import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import MyIdeasPage from '../pages/MyIdeasPage.vue';
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
    getOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
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
    title: 'My submitted idea',
    description: 'Some description text',
    benefits: 'Some benefits',
    effort: Effort.LESS_THAN_ONE_DAY,
    status: IdeaStatus.SUBMITTED,
    tags: [],
    submitterId: 'u1',
    submitter: { id: 'u1', name: 'Me', email: 'me@x.com', role: Role.USER },
    submittedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ideasApi.getAll resolves the paginated envelope (see `paginated` in helpers).

function mountPage() {
  return mount(MyIdeasPage, {
    global: { plugins: [createTestVuetify(), createTestI18n('en')] },
  });
}

describe('MyIdeasPage', () => {
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

  it('loads the current user\'s ideas on mount with the submitterId filter', async () => {
    mountPage();
    await flushPromises();

    expect(mockedIdeas.getAll).toHaveBeenCalledTimes(1);
    expect(mockedIdeas.getAll).toHaveBeenCalledWith({
      limit: MAX_PAGE_LIMIT,
      page: 1,
      submitterId: 'u1',
    });
  });

  it('renders an IdeaCard per returned idea', async () => {
    mockedIdeas.getAll.mockResolvedValue(
      paginated([
        makeIdea({ id: 'a', title: 'First idea' }),
        makeIdea({ id: 'b', title: 'Second idea' }),
      ])
    );
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.findAllComponents({ name: 'IdeaCard' })).toHaveLength(2);
    expect(wrapper.text()).toContain('First idea');
    expect(wrapper.text()).toContain('Second idea');
  });

  it('shows the empty-state alert when there are no ideas', async () => {
    mockedIdeas.getAll.mockResolvedValue(paginated([]));
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('You have not submitted any ideas yet.');
  });

  const filterCases = [
    { status: IdeaStatus.SUBMITTED },
    { status: IdeaStatus.APPROVED },
    { status: IdeaStatus.IN_PROGRESS },
    { status: IdeaStatus.DONE },
    { status: IdeaStatus.REJECTED },
  ] as const;

  describe.each(filterCases)('status filter = $status', ({ status }) => {
    it(`re-queries getAll with { status: ${status}, submitterId }`, async () => {
      const wrapper = mountPage();
      await flushPromises();
      mockedIdeas.getAll.mockClear();

      const select = wrapper.findComponent({ name: 'VSelect' });
      select.vm.$emit('update:modelValue', status);
      await flushPromises();

      expect(mockedIdeas.getAll).toHaveBeenCalledTimes(1);
      expect(mockedIdeas.getAll).toHaveBeenCalledWith({
        limit: MAX_PAGE_LIMIT,
        page: 1,
        status,
        submitterId: 'u1',
      });
    });
  });

  it('passes departmentId to getAll when a department filter is selected', async () => {
    const wrapper = mountPage();
    await flushPromises();
    mockedIdeas.getAll.mockClear();

    // Second VSelect is the department filter (first is the status filter).
    const departmentSelect = wrapper.findAllComponents({ name: 'VSelect' })[1];
    departmentSelect.vm.$emit('update:modelValue', 'd2');
    await flushPromises();

    expect(mockedIdeas.getAll).toHaveBeenCalledTimes(1);
    expect(mockedIdeas.getAll).toHaveBeenCalledWith({
      limit: MAX_PAGE_LIMIT,
      page: 1,
      departmentId: 'd2',
      submitterId: 'u1',
    });
  });

  it('omits submitterId when there is no authenticated user', async () => {
    const auth = useAuthStore();
    auth.user = null;
    mountPage();
    await flushPromises();

    expect(mockedIdeas.getAll).toHaveBeenCalledWith({ limit: MAX_PAGE_LIMIT, page: 1 });
  });

  it('renders the pager when my ideas span multiple pages and fetches the selected page', async () => {
    mockedIdeas.getAll.mockResolvedValue(paginated([makeIdea()], 250));
    const wrapper = mountPage();
    await flushPromises();

    const pager = wrapper.findComponent({ name: 'VPagination' });
    expect(pager.exists()).toBe(true);
    expect(pager.props('length')).toBe(3);

    mockedIdeas.getAll.mockClear();
    pager.vm.$emit('update:modelValue', 2);
    await flushPromises();
    expect(mockedIdeas.getAll).toHaveBeenCalledWith({
      limit: MAX_PAGE_LIMIT,
      page: 2,
      submitterId: 'u1',
    });
  });

  it('renders no pager when everything fits on one page', async () => {
    mockedIdeas.getAll.mockResolvedValue(paginated([makeIdea()]));
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.findComponent({ name: 'VPagination' }).exists()).toBe(false);
  });

  it('resets to page 1 when the status filter changes after paging', async () => {
    mockedIdeas.getAll.mockResolvedValue(paginated([makeIdea()], 250));
    const wrapper = mountPage();
    await flushPromises();
    wrapper.findComponent({ name: 'VPagination' }).vm.$emit('update:modelValue', 2);
    await flushPromises();
    mockedIdeas.getAll.mockClear();

    wrapper.findAllComponents({ name: 'VSelect' })[0].vm.$emit('update:modelValue', IdeaStatus.DONE);
    await flushPromises();
    expect(mockedIdeas.getAll).toHaveBeenCalledWith({
      limit: MAX_PAGE_LIMIT,
      page: 1,
      status: IdeaStatus.DONE,
      submitterId: 'u1',
    });
  });

  it('navigates to the idea detail page on "view"', async () => {
    mockedIdeas.getAll.mockResolvedValue(paginated([makeIdea({ id: 'idea-99' })]));
    const wrapper = mountPage();
    await flushPromises();

    wrapper.findComponent({ name: 'IdeaCard' }).vm.$emit('view', 'idea-99');
    await flushPromises();

    expect(mockPush).toHaveBeenCalledWith({ name: 'IdeaDetail', params: { id: 'idea-99' } });
  });
});
