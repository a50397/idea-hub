import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import ApprovedIdeasPage from '../pages/ApprovedIdeasPage.vue';
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
    createJiraTask: vi.fn(),
    getJiraTarget: vi.fn(),
  },
}));

// The dispatch dialog fetches the tech account's visible projects on every open.
vi.mock('../api/jiraSettings', () => ({
  jiraSettingsApi: {
    getProjects: vi.fn(),
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

// onMounted fetches runtime options (via the options store) to gate the button.
vi.mock('../api/options', () => ({
  optionsApi: {
    get: vi.fn(),
  },
}));

import { ideasApi } from '../api/ideas';
import { departmentsApi } from '../api/departments';
import { optionsApi } from '../api/options';
import { jiraSettingsApi } from '../api/jiraSettings';
const mockedIdeas = vi.mocked(ideasApi);
const mockedDepartments = vi.mocked(departmentsApi);
const mockedOptions = vi.mocked(optionsApi);
const mockedJiraSettings = vi.mocked(jiraSettingsApi);

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

// A full server page of distinct ideas, for the truncation boundary.
const fullPage = () =>
  Array.from({ length: MAX_PAGE_LIMIT }, (_, i) => makeIdea({ id: `idea-${i}`, title: `Idea ${i}` }));

// The v-snackbar's content is teleported outside the wrapper's own DOM subtree, so
// assertions on it must go through document.body. Vuetify's overlay teleport target
// is never cleaned up between tests (nothing here unmounts a wrapper by default),
// so a PREVIOUS test's snackbar text/links would otherwise leak into a later
// document.body query — track and unmount every mounted wrapper after each test.
let mountedWrappers: VueWrapper[] = [];

function mountPage() {
  const wrapper = mount(ApprovedIdeasPage, {
    global: { plugins: [createTestVuetify(), createTestI18n('en')] },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

afterEach(() => {
  mountedWrappers.forEach((w) => w.unmount());
  mountedWrappers = [];
});

function signIn(role: Role) {
  const auth = useAuthStore();
  auth.user = { id: 'actor1', name: 'Actor', email: 'actor@x.com', role };
}

describe('ApprovedIdeasPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockedIdeas.getAll.mockResolvedValue(paginated([makeIdea()]));
    mockedDepartments.getAll.mockResolvedValue([
      { id: 'd1', name: 'General', order: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'd2', name: 'Marketing', order: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    mockedOptions.get.mockResolvedValue({ mailEnabled: false, webexEnabled: false, jiraEnabled: true, ssoShowLogout: false });
    vi.spyOn(window, 'open').mockImplementation(() => null);
    signIn(Role.USER);
  });

  it('loads approved ideas org-wide for a basic USER (no submitterId) at the max page limit', async () => {
    mountPage();
    await flushPromises();

    expect(mockedIdeas.getAll).toHaveBeenCalledTimes(1);
    expect(mockedIdeas.getAll).toHaveBeenCalledWith({
      status: IdeaStatus.APPROVED,
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
      status: IdeaStatus.APPROVED,
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
    expect(wrapper.text()).toContain('Other Person');
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
      status: IdeaStatus.APPROVED,
      limit: MAX_PAGE_LIMIT,
      page: 2,
    });

    mockedIdeas.getAll.mockClear();
    wrapper.findComponent({ name: 'VSelect' }).vm.$emit('update:modelValue', 'd2');
    await flushPromises();
    expect(mockedIdeas.getAll).toHaveBeenCalledWith({
      status: IdeaStatus.APPROVED,
      limit: MAX_PAGE_LIMIT,
      page: 1,
      departmentId: 'd2',
    });
  });

  it('snaps back into range when the requested page no longer exists', async () => {
    mockedIdeas.getAll.mockResolvedValue(paginated(fullPage(), 250));
    const wrapper = mountPage();
    await flushPromises();
    mockedIdeas.getAll.mockClear();

    // The requested page has meanwhile emptied: the server now reports 1 page.
    mockedIdeas.getAll
      .mockResolvedValueOnce(paginated([], 2))
      .mockResolvedValueOnce(paginated([makeIdea({ id: 'x1' }), makeIdea({ id: 'x2' })], 2));

    wrapper.findComponent({ name: 'VPagination' }).vm.$emit('update:modelValue', 3);
    await flushPromises();

    expect(mockedIdeas.getAll).toHaveBeenCalledTimes(2);
    expect(mockedIdeas.getAll.mock.calls[0][0]).toMatchObject({ page: 3 });
    expect(mockedIdeas.getAll.mock.calls[1][0]).toMatchObject({ page: 1 });
    expect(wrapper.findAllComponents({ name: 'IdeaCard' })).toHaveLength(2);
    // One page left → the pager disappears entirely.
    expect(wrapper.findComponent({ name: 'VPagination' }).exists()).toBe(false);
  });

  it('reverts the pager and surfaces an error when a page fetch fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedIdeas.getAll.mockResolvedValue(paginated(fullPage(), 250));
    const wrapper = mountPage();
    await flushPromises();
    mockedIdeas.getAll.mockRejectedValueOnce(new Error('network boom'));

    wrapper.findComponent({ name: 'VPagination' }).vm.$emit('update:modelValue', 2);
    await flushPromises();

    // The pager returns to the page whose rows are still on screen, so the
    // highlighted number stays truthful and clicking "2" again re-fetches.
    expect(wrapper.findComponent({ name: 'VPagination' }).props('modelValue')).toBe(1);
    expect(wrapper.findAllComponents({ name: 'IdeaCard' })).toHaveLength(MAX_PAGE_LIMIT);
    const snackbar = wrapper.findComponent({ name: 'VSnackbar' });
    expect(snackbar.props('modelValue')).toBe(true);
    expect(snackbar.props('color')).toBe('error');
    expect(document.body.textContent).toContain('Failed to load ideas.');

    consoleSpy.mockRestore();
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

  describe('Create Jira task button gating', () => {
    it('shows the button for a POWER_USER when Jira is enabled and the idea is not yet dispatched', async () => {
      signIn(Role.POWER_USER);
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.text()).toContain('Create Jira task');
    });

    it('shows the button for an ADMIN', async () => {
      signIn(Role.ADMIN);
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.text()).toContain('Create Jira task');
    });

    it('hides the button for a regular USER', async () => {
      signIn(Role.USER);
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.text()).not.toContain('Create Jira task');
    });

    it('hides the button when Jira is not enabled', async () => {
      mockedOptions.get.mockResolvedValue({ mailEnabled: false, webexEnabled: false, jiraEnabled: false, ssoShowLogout: false });
      signIn(Role.POWER_USER);
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.text()).not.toContain('Create Jira task');
    });

    it("replaces the button with IdeaCard's linked Jira chip once dispatched (jiraSyncActive)", async () => {
      mockedIdeas.getAll.mockResolvedValue(paginated([makeIdea({ jiraSyncActive: true, jiraIssueKey: 'OPS-1' })]));
      signIn(Role.POWER_USER);
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.text()).not.toContain('Create Jira task');
      expect(wrapper.text()).toContain('OPS-1');
    });

    it('shows the chip to a regular USER too (it is not power-user gated)', async () => {
      mockedIdeas.getAll.mockResolvedValue(paginated([makeIdea({ jiraSyncActive: true, jiraIssueKey: 'OPS-1' })]));
      signIn(Role.USER);
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.text()).toContain('OPS-1');
    });

    it('renders the chip as a new-tab noopener LINK when the server provided a browse URL', async () => {
      mockedIdeas.getAll.mockResolvedValue(
        paginated([
          makeIdea({
            jiraSyncActive: true,
            jiraIssueKey: 'OPS-1',
            jiraBrowseUrl: 'https://acme.atlassian.net/browse/OPS-1',
          }),
        ])
      );
      signIn(Role.USER);
      const wrapper = mountPage();
      await flushPromises();

      // The durable popup-blocker fallback (deep-review fix A6): the chip itself
      // links to the issue.
      const link = wrapper
        .findAll('a')
        .find((a) => a.attributes('href') === 'https://acme.atlassian.net/browse/OPS-1');
      expect(link).toBeTruthy();
      expect(link!.attributes('target')).toBe('_blank');
      expect(link!.attributes('rel')).toBe('noopener');
      expect(link!.text()).toContain('OPS-1');
    });

    it('renders a plain (non-link) chip when no browse URL is present', async () => {
      mockedIdeas.getAll.mockResolvedValue(paginated([makeIdea({ jiraSyncActive: true, jiraIssueKey: 'OPS-1' })]));
      signIn(Role.USER);
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.text()).toContain('OPS-1');
      expect(
        wrapper.findAll('a').find((a) => (a.text() || '').includes('OPS-1'))
      ).toBeUndefined();
    });
  });

  describe('createJiraTask dispatch flow', () => {
    beforeEach(() => {
      signIn(Role.POWER_USER);
      mockedJiraSettings.getProjects.mockResolvedValue({ projects: [] });
      // The dialog preselects the RESOLVED target (dept override ?? default).
      mockedIdeas.getJiraTarget.mockResolvedValue({ projectKey: 'OPS' });
    });

    /** Click the card button, let the preselection land, confirm in the dialog. */
    async function openAndConfirmDispatch(wrapper: ReturnType<typeof mountPage>) {
      const btn = wrapper.findAll('.v-btn').find((b) => b.text().trim() === 'Create Jira task');
      await btn!.trigger('click');
      await flushPromises(); // the /jira-target preselection resolves
      const dialog = wrapper.findAllComponents({ name: 'VDialog' })[0];
      const confirm = dialog
        .findAllComponents({ name: 'VBtn' })
        .find((b) => b.text().trim() === 'Create Jira task');
      await confirm!.trigger('click');
      await flushPromises();
    }

    it('opens the browse URL in a new tab and shows a success snackbar with the link as a fallback', async () => {
      mockedIdeas.createJiraTask.mockResolvedValue(
        makeIdea({ jiraSyncActive: true, jiraIssueKey: 'OPS-1', jiraBrowseUrl: 'https://acme.atlassian.net/browse/OPS-1' })
      );
      const wrapper = mountPage();
      await flushPromises();

      await openAndConfirmDispatch(wrapper);

      // Confirmed with the PRESELECTED resolved project: the key always travels.
      expect(mockedIdeas.createJiraTask).toHaveBeenCalledWith('idea-1', 'OPS');
      expect(window.open).toHaveBeenCalledWith('https://acme.atlassian.net/browse/OPS-1', '_blank', 'noopener');
      // The snackbar is teleported to document.body (like a dialog) — safe to
      // assert there because every wrapper is unmounted after each test (afterEach
      // above), so no earlier test's teleported content can linger.
      expect(document.body.textContent).toContain('OPS-1');
      const link = Array.from(document.querySelectorAll('a')).find(
        (a) => a.textContent?.trim() === 'https://acme.atlassian.net/browse/OPS-1'
      );
      expect(link).toBeTruthy();
      expect(link!.getAttribute('href')).toBe('https://acme.atlassian.net/browse/OPS-1');
    });

    it('handles a missing jiraBrowseUrl gracefully: no popup, no dead link, still shows success and reloads', async () => {
      mockedIdeas.createJiraTask.mockResolvedValue(makeIdea({ jiraSyncActive: true, jiraIssueKey: 'OPS-2' }));
      const wrapper = mountPage();
      await flushPromises();

      await openAndConfirmDispatch(wrapper);

      expect(window.open).not.toHaveBeenCalled();
      const snackbar = wrapper.findComponent({ name: 'VSnackbar' });
      expect(snackbar.props('modelValue')).toBe(true);
      expect(snackbar.props('color')).toBe('success');
      expect(document.body.textContent).toContain('OPS-2');
      expect(document.querySelectorAll('a')).toHaveLength(0);
      // The list is reloaded after a successful dispatch.
      expect(mockedIdeas.getAll).toHaveBeenCalledTimes(2);
    });

    it('surfaces a 409 already-dispatched failure as the LOCALIZED conflict message (never the raw server string)', async () => {
      mockedIdeas.createJiraTask.mockRejectedValueOnce({
        response: { status: 409, data: { error: 'raw English server text — must not appear' } },
      });
      const wrapper = mountPage();
      await flushPromises();

      await openAndConfirmDispatch(wrapper);

      expect(window.open).not.toHaveBeenCalled();
      const snackbar = wrapper.findComponent({ name: 'VSnackbar' });
      expect(snackbar.props('color')).toBe('error');
      expect(document.body.textContent).toContain('A Jira task for this idea is already being created.');
      expect(document.body.textContent).not.toContain('must not appear');
    });

    it('maps a 502 reason through the settings testReason catalog', async () => {
      mockedIdeas.createJiraTask.mockRejectedValueOnce({
        response: { status: 502, data: { error: 'Failed to create the Jira issue', reason: 'rate_limited' } },
      });
      const wrapper = mountPage();
      await flushPromises();

      await openAndConfirmDispatch(wrapper);

      expect(document.body.textContent).toContain('Jira rate limit reached — wait a moment and try again.');
      expect(document.body.textContent).not.toContain('Failed to create the Jira issue');
    });

    it('passes an explicitly chosen project key (uppercased) and fetches the projects list on open', async () => {
      mockedJiraSettings.getProjects.mockResolvedValue({
        projects: [{ key: 'OPS2', name: 'Operations 2' }],
      });
      mockedIdeas.createJiraTask.mockResolvedValue(makeIdea({ jiraSyncActive: true, jiraIssueKey: 'OPS2-1' }));
      const wrapper = mountPage();
      await flushPromises();

      const btn = wrapper.findAll('.v-btn').find((b) => b.text().trim() === 'Create Jira task');
      await btn!.trigger('click');
      await flushPromises();
      expect(mockedJiraSettings.getProjects).toHaveBeenCalledTimes(1);

      const dialog = wrapper.findAllComponents({ name: 'VDialog' })[0];
      // Manual entry (the combobox also accepts raw keys); lowercase input is
      // normalized to uppercase before it travels.
      await dialog.findComponent({ name: 'VCombobox' }).setValue('ops2');
      const confirm = dialog
        .findAllComponents({ name: 'VBtn' })
        .find((b) => b.text().trim() === 'Create Jira task');
      await confirm!.trigger('click');
      await flushPromises();

      expect(mockedIdeas.createJiraTask).toHaveBeenCalledWith('idea-1', 'OPS2');
    });

    it('discards a LATE preselection response from a previously opened dialog (cross-idea race)', async () => {
      mockedIdeas.getAll.mockResolvedValue(
        paginated([makeIdea({ id: 'idea-1', title: 'First idea' }), makeIdea({ id: 'idea-2', title: 'Second idea' })])
      );
      let resolveFirstTarget!: (v: { projectKey: string | null }) => void;
      mockedIdeas.getJiraTarget
        // idea-1's resolution HANGS until we release it below…
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstTarget = resolve; }))
        // …idea-2's own resolution has nothing to preselect.
        .mockResolvedValueOnce({ projectKey: null });
      const wrapper = mountPage();
      await flushPromises();

      const buttons = wrapper.findAll('.v-btn').filter((b) => b.text().trim() === 'Create Jira task');
      await buttons[0].trigger('click'); // open for idea-1 (target still pending)
      const dialog = wrapper.findAllComponents({ name: 'VDialog' })[0];
      const cancel = dialog.findAllComponents({ name: 'VBtn' }).find((b) => b.text().trim() === 'Cancel');
      await cancel!.trigger('click');
      await buttons[1].trigger('click'); // quickly reopen for idea-2
      await flushPromises(); // idea-2's (empty) resolution lands

      resolveFirstTarget({ projectKey: 'MKT' }); // idea-1's LATE response arrives
      await flushPromises();

      // Without the identity guard this would read 'MKT' — idea-1's department
      // project inside idea-2's dialog.
      expect(dialog.findComponent({ name: 'VCombobox' }).props('modelValue')).toBe('');
    });

    it('keeps the confirm disabled while no project is resolvable and none was entered', async () => {
      mockedIdeas.getJiraTarget.mockResolvedValue({ projectKey: null });
      const wrapper = mountPage();
      await flushPromises();

      const btn = wrapper.findAll('.v-btn').find((b) => b.text().trim() === 'Create Jira task');
      await btn!.trigger('click');
      await flushPromises();

      const dialog = wrapper.findAllComponents({ name: 'VDialog' })[0];
      const confirm = dialog
        .findAllComponents({ name: 'VBtn' })
        .find((b) => b.text().trim() === 'Create Jira task');
      expect(confirm!.props('disabled')).toBe(true);
      expect(mockedIdeas.createJiraTask).not.toHaveBeenCalled();
    });
  });
});
