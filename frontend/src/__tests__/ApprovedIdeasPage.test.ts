import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import ApprovedIdeasPage from '../pages/ApprovedIdeasPage.vue';
import { useAuthStore } from '../stores/auth';
import { IdeaStatus, Effort, Role, MAX_PAGE_LIMIT } from '../types';
import type { Idea } from '../types';
import { createTestI18n, createTestVuetify, findByText, paginated as envelope } from './helpers';

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useRoute: () => ({ query: {} }),
}));

vi.mock('../api/ideas', () => ({
  ideasApi: {
    getAll: vi.fn(),
    claim: vi.fn(),
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
    title: 'Someone else\'s approved idea',
    description: 'Some description text',
    benefits: 'Some benefits',
    effort: Effort.LESS_THAN_ONE_DAY,
    status: IdeaStatus.APPROVED,
    tags: [],
    submitterId: 'u2',
    submitter: { id: 'u2', name: 'Other Person', email: 'other@x.com', role: Role.USER },
    submittedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// This page always asks for the maximum page, so mirror that in the envelope.
const paginated = (data: Idea[], total = data.length) => envelope(data, total, MAX_PAGE_LIMIT);

// A full server page of distinct ideas, for the truncation boundary.
const fullPage = () =>
  Array.from({ length: MAX_PAGE_LIMIT }, (_, i) => makeIdea({ id: `idea-${i}`, title: `Idea ${i}` }));

function mountPage() {
  return mount(ApprovedIdeasPage, {
    global: { plugins: [createTestVuetify(), createTestI18n('en')] },
  });
}

// The confirm dialog is teleported out of the wrapper's DOM, but its buttons
// stay in the component tree (same approach as UsersPage.test.ts).
function dialogButton(wrapper: VueWrapper, text: string) {
  return wrapper
    .findAllComponents({ name: 'VBtn' })
    .find((b) => b.text().trim() === text);
}

describe('ApprovedIdeasPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockedIdeas.getAll.mockResolvedValue(paginated([]));
    mockedIdeas.claim.mockResolvedValue(makeIdea({ status: IdeaStatus.IN_PROGRESS }));
    mockedDepartments.getAll.mockResolvedValue([
      { id: 'd1', name: 'General', order: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'd2', name: 'Marketing', order: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const auth = useAuthStore();
    auth.user = { id: 'u1', name: 'Me', email: 'me@x.com', role: Role.USER };
  });

  it('loads approved ideas org-wide for a basic USER (no submitterId) at the max page limit', async () => {
    mountPage();
    await flushPromises();

    expect(mockedIdeas.getAll).toHaveBeenCalledTimes(1);
    expect(mockedIdeas.getAll).toHaveBeenCalledWith({
      status: IdeaStatus.APPROVED,
      limit: MAX_PAGE_LIMIT,
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
      status: IdeaStatus.APPROVED,
      limit: MAX_PAGE_LIMIT,
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
    expect(wrapper.text()).toContain('Other Person');
  });

  it('shows the truncation notice when the server reports more matches than rows', async () => {
    mockedIdeas.getAll.mockResolvedValue(paginated([makeIdea()], 250));
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('Showing the first 1 of 250 ideas.');
  });

  it('shows no truncation notice when every match is on the page', async () => {
    mockedIdeas.getAll.mockResolvedValue(paginated([makeIdea()]));
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).not.toContain('Showing the first');
  });

  // Boundary: the notice must fire only when the server actually withheld rows,
  // i.e. at total = MAX_PAGE_LIMIT + 1, never at exactly a full page.
  it('shows NO truncation notice at exactly a full page (total = rows = MAX_PAGE_LIMIT)', async () => {
    mockedIdeas.getAll.mockResolvedValue(paginated(fullPage(), MAX_PAGE_LIMIT));
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).not.toContain('Showing the first');
  });

  it('shows the truncation notice one match past a full page (total = MAX_PAGE_LIMIT + 1)', async () => {
    mockedIdeas.getAll.mockResolvedValue(paginated(fullPage(), MAX_PAGE_LIMIT + 1));
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain(
      `Showing the first ${MAX_PAGE_LIMIT} of ${MAX_PAGE_LIMIT + 1} ideas.`
    );
  });

  it('clears the spinner and renders the empty state when getAll rejects', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedIdeas.getAll.mockRejectedValueOnce(new Error('network boom'));

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('.v-progress-circular').exists()).toBe(false);
    expect(wrapper.findAllComponents({ name: 'IdeaCard' })).toHaveLength(0);
    expect(wrapper.text()).toContain('No approved ideas available.');

    consoleSpy.mockRestore();
  });

  describe('claim confirmation', () => {
    async function openDialog() {
      mockedIdeas.getAll.mockResolvedValue(paginated([makeIdea({ id: 'idea-7', title: 'Claimable idea' })]));
      const wrapper = mountPage();
      await flushPromises();

      const claimStart = findByText(wrapper, 'button', 'Claim & Start');
      expect(claimStart).toBeTruthy();
      await claimStart!.trigger('click');
      await flushPromises();
      return wrapper;
    }

    it('opens a confirm dialog naming the idea instead of claiming immediately', async () => {
      const wrapper = await openDialog();

      expect(wrapper.findComponent({ name: 'VDialog' }).props('modelValue')).toBe(true);
      expect(document.body.textContent).toContain('Claim Idea');
      expect(document.body.textContent).toContain('Claimable idea');
      expect(mockedIdeas.claim).not.toHaveBeenCalled();
    });

    it('claims the idea when the dialog is confirmed', async () => {
      const wrapper = await openDialog();

      await dialogButton(wrapper, 'Claim')!.trigger('click');
      await flushPromises();

      expect(mockedIdeas.claim).toHaveBeenCalledTimes(1);
      expect(mockedIdeas.claim).toHaveBeenCalledWith('idea-7');
      expect(wrapper.findComponent({ name: 'VDialog' }).props('modelValue')).toBe(false);
    });

    it('does not claim the idea when the dialog is cancelled', async () => {
      const wrapper = await openDialog();

      await dialogButton(wrapper, 'Cancel')!.trigger('click');
      await flushPromises();

      expect(mockedIdeas.claim).not.toHaveBeenCalled();
      expect(wrapper.findComponent({ name: 'VDialog' }).props('modelValue')).toBe(false);
    });

    // Regression: the losing side of a claim race used to be left with the dialog
    // open over a stale card, so every re-confirm produced another 400. A failed
    // claim must close the dialog AND refetch, on top of surfacing the error.
    it('closes the dialog and refetches the list when the claim is rejected', async () => {
      const wrapper = await openDialog();
      mockedIdeas.claim.mockRejectedValueOnce({
        response: { data: { error: 'Idea is not available for claiming' } },
      });
      // openDialog already consumed the mount fetch; count only what follows.
      mockedIdeas.getAll.mockClear();

      await dialogButton(wrapper, 'Claim')!.trigger('click');
      await flushPromises();

      expect(mockedIdeas.claim).toHaveBeenCalledTimes(1);
      // The stale card is refreshed away instead of being re-confirmable.
      expect(mockedIdeas.getAll).toHaveBeenCalledTimes(1);
      expect(wrapper.findComponent({ name: 'VDialog' }).props('modelValue')).toBe(false);
      // The error is still surfaced to the user.
      const snackbar = wrapper.findComponent({ name: 'VSnackbar' });
      expect(snackbar.props('modelValue')).toBe(true);
      expect(snackbar.props('color')).toBe('error');
      expect(document.body.textContent).toContain('Idea is not available for claiming');
    });
  });
});
