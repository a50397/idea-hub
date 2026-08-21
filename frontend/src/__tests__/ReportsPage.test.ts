import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import ReportsPage from '../pages/ReportsPage.vue';
import { useAuthStore } from '../stores/auth';
import { IdeaStatus, Effort, Role, MAX_PAGE_LIMIT } from '../types';
import type { Idea } from '../types';
import { createTestI18n, createTestVuetify, findByText, paginated } from './helpers';

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useRoute: () => ({ query: {} }),
}));

vi.mock('../api/reports', () => ({
  reportsApi: {
    getFiltered: vi.fn(),
    exportCSV: vi.fn(),
  },
}));

// The page can delete ideas as ADMIN; stub the whole ideas module.
vi.mock('../api/ideas', () => ({
  ideasApi: {
    delete: vi.fn(),
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

import { reportsApi } from '../api/reports';
import { ideasApi } from '../api/ideas';
import { departmentsApi } from '../api/departments';
const mockedReports = vi.mocked(reportsApi);
const mockedIdeas = vi.mocked(ideasApi);
const mockedDepartments = vi.mocked(departmentsApi);

// An idea submitted by somebody else: a basic USER must still see it.
function makeIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: 'idea-1',
    title: 'Someone else\'s idea',
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
  return mount(ReportsPage, {
    global: { plugins: [createTestVuetify(), createTestI18n('en')] },
  });
}

async function clickExport(wrapper: ReturnType<typeof mountPage>) {
  const button = findByText(wrapper, 'button', 'Export CSV');
  expect(button).toBeTruthy();
  await button!.trigger('click');
  await flushPromises();
}

// The "Filtered Results (n)" span, i.e. the count shown next to the card title.
const resultsHeader = (wrapper: ReturnType<typeof mountPage>) =>
  wrapper.find('.v-card-title .flex-grow-1').text();

const snackbarOf = (wrapper: ReturnType<typeof mountPage>) =>
  wrapper.findComponent({ name: 'VSnackbar' });

// The data table's rendered column headers.
const tableHeaders = (wrapper: ReturnType<typeof mountPage>) =>
  wrapper.findAll('thead th').map((th) => th.text().trim());

describe('ReportsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockedReports.getFiltered.mockResolvedValue(paginated([]));
    mockedReports.exportCSV.mockResolvedValue(new Blob(['id,title'], { type: 'text/csv' }));
    mockedDepartments.getAll.mockResolvedValue([
      { id: 'd1', name: 'General', order: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'd2', name: 'Marketing', order: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const auth = useAuthStore();
    auth.user = { id: 'u1', name: 'Me', email: 'me@x.com', role: Role.USER };
    // happy-dom has no blob URL plumbing; the export path only needs the handles.
    window.URL.createObjectURL = vi.fn(() => 'blob:mock');
    window.URL.revokeObjectURL = vi.fn();
    // Overlays (snackbar) teleport to <body>; drop the previous test's leftovers.
    document.body.innerHTML = '';
  });

  it('loads the filtered report org-wide for a basic USER (no submitterId) at the max page limit', async () => {
    mountPage();
    await flushPromises();

    expect(mockedReports.getFiltered).toHaveBeenCalledTimes(1);
    expect(mockedReports.getFiltered).toHaveBeenCalledWith({ limit: MAX_PAGE_LIMIT, page: 1 });
    expect(mockedReports.getFiltered.mock.calls[0][0]).not.toHaveProperty('submitterId');
  });

  it('renders rows submitted by other users', async () => {
    mockedReports.getFiltered.mockResolvedValue(
      paginated([makeIdea({ id: 'a', title: 'Idea from Other Person' })])
    );
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('Idea from Other Person');
    expect(wrapper.text()).toContain('Other Person');
  });

  it('renders the pager when the matches span multiple pages', async () => {
    mockedReports.getFiltered.mockResolvedValue(paginated([makeIdea()], 250));
    const wrapper = mountPage();
    await flushPromises();

    const pager = wrapper.findComponent({ name: 'VPagination' });
    expect(pager.exists()).toBe(true);
    expect(pager.props('length')).toBe(3);
  });

  it('renders no pager when every match fits on one page', async () => {
    mockedReports.getFiltered.mockResolvedValue(paginated([makeIdea()]));
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.findComponent({ name: 'VPagination' }).exists()).toBe(false);
  });

  // Boundary: the pager must appear only when the server actually withheld rows,
  // i.e. at total = MAX_PAGE_LIMIT + 1, never at exactly a full page.
  it('renders no pager at exactly a full page (total = rows = MAX_PAGE_LIMIT)', async () => {
    mockedReports.getFiltered.mockResolvedValue(paginated(fullPage(), MAX_PAGE_LIMIT));
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.findComponent({ name: 'VPagination' }).exists()).toBe(false);
  });

  it('renders the pager one match past a full page (total = MAX_PAGE_LIMIT + 1)', async () => {
    mockedReports.getFiltered.mockResolvedValue(paginated(fullPage(), MAX_PAGE_LIMIT + 1));
    const wrapper = mountPage();
    await flushPromises();

    const pager = wrapper.findComponent({ name: 'VPagination' });
    expect(pager.exists()).toBe(true);
    expect(pager.props('length')).toBe(2);
  });

  it('fetches the selected page and resets to page 1 when filters are applied', async () => {
    mockedReports.getFiltered.mockResolvedValue(paginated(fullPage(), 250));
    const wrapper = mountPage();
    await flushPromises();
    mockedReports.getFiltered.mockClear();

    wrapper.findComponent({ name: 'VPagination' }).vm.$emit('update:modelValue', 2);
    await flushPromises();
    expect(mockedReports.getFiltered).toHaveBeenCalledWith({ limit: MAX_PAGE_LIMIT, page: 2 });

    mockedReports.getFiltered.mockClear();
    const applyButton = wrapper
      .findAllComponents({ name: 'VBtn' })
      .find((b) => b.text().trim() === 'Apply');
    await applyButton!.trigger('click');
    await flushPromises();
    expect(mockedReports.getFiltered).toHaveBeenCalledWith({ limit: MAX_PAGE_LIMIT, page: 1 });
  });

  it('resets to page 1 when filters are reset', async () => {
    mockedReports.getFiltered.mockResolvedValue(paginated(fullPage(), 250));
    const wrapper = mountPage();
    await flushPromises();
    wrapper.findComponent({ name: 'VPagination' }).vm.$emit('update:modelValue', 2);
    await flushPromises();
    mockedReports.getFiltered.mockClear();

    const resetButton = wrapper
      .findAllComponents({ name: 'VBtn' })
      .find((b) => b.text().trim() === 'Reset');
    await resetButton!.trigger('click');
    await flushPromises();

    expect(mockedReports.getFiltered).toHaveBeenCalledWith({ limit: MAX_PAGE_LIMIT, page: 1 });
  });

  // Filters commit only via Apply: a pager click must not silently submit
  // half-edited form state (the fetch reads the applied-filters snapshot).
  it('ignores unapplied filter edits on a pager click', async () => {
    mockedReports.getFiltered.mockResolvedValue(paginated(fullPage(), 250));
    const wrapper = mountPage();
    await flushPromises();
    mockedReports.getFiltered.mockClear();

    wrapper.findAllComponents({ name: 'VSelect' })[0].vm.$emit('update:modelValue', IdeaStatus.DONE);
    wrapper.findComponent({ name: 'VPagination' }).vm.$emit('update:modelValue', 2);
    await flushPromises();
    expect(mockedReports.getFiltered).toHaveBeenCalledWith({ limit: MAX_PAGE_LIMIT, page: 2 });

    mockedReports.getFiltered.mockClear();
    const applyButton = wrapper
      .findAllComponents({ name: 'VBtn' })
      .find((b) => b.text().trim() === 'Apply');
    await applyButton!.trigger('click');
    await flushPromises();
    expect(mockedReports.getFiltered).toHaveBeenCalledWith({
      status: IdeaStatus.DONE,
      limit: MAX_PAGE_LIMIT,
      page: 1,
    });
  });

  it('keeps the current page when a row is deleted', async () => {
    const auth = useAuthStore();
    auth.user = { id: 'u1', name: 'Admin Ada', email: 'ada@x.com', role: Role.ADMIN };
    mockedReports.getFiltered.mockResolvedValue(paginated(fullPage(), 250));
    mockedIdeas.delete.mockResolvedValue(undefined as never);
    const wrapper = mountPage();
    await flushPromises();
    wrapper.findComponent({ name: 'VPagination' }).vm.$emit('update:modelValue', 2);
    await flushPromises();
    mockedReports.getFiltered.mockClear();

    const deleteButton = wrapper
      .findAllComponents({ name: 'VBtn' })
      .find((b) => b.find('.mdi-delete').exists());
    await deleteButton!.trigger('click');
    await flushPromises();
    const confirmButton = wrapper
      .findAllComponents({ name: 'VBtn' })
      .find((b) => b.text().trim() === 'Delete');
    await confirmButton!.trigger('click');
    await flushPromises();

    expect(mockedIdeas.delete).toHaveBeenCalledTimes(1);
    // The refetch stays on page 2 (the clamp snaps back only if it emptied).
    expect(mockedReports.getFiltered).toHaveBeenCalledWith({ limit: MAX_PAGE_LIMIT, page: 2 });
  });

  // Regression: the header used to count `ideas.length` (the page size), which
  // contradicted the real match count — "(100)" for a 250-match filter.
  it('renders the full match count in the header, not the page size', async () => {
    mockedReports.getFiltered.mockResolvedValue(paginated(fullPage(), 250));
    const wrapper = mountPage();
    await flushPromises();

    expect(resultsHeader(wrapper)).toBe('Filtered Results (250)');
  });

  it('renders 0 in the header before the first fetch resolves', async () => {
    const wrapper = mountPage();

    expect(resultsHeader(wrapper)).toBe('Filtered Results (0)');

    await flushPromises();
  });

  it('surfaces the filter failure and clears the table spinner when getFiltered rejects', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedReports.getFiltered.mockRejectedValueOnce(new Error('filter boom'));

    const wrapper = mountPage();
    await flushPromises();

    const snackbar = snackbarOf(wrapper);
    expect(snackbar.props('modelValue')).toBe(true);
    expect(snackbar.props('color')).toBe('error');
    expect(document.body.textContent).toContain('Failed to load filtered data');
    expect(wrapper.findComponent({ name: 'VDataTable' }).props('loading')).toBe(false);

    consoleSpy.mockRestore();
  });

  // Org-wide READS do not widen write affordances: deleting stays admin-only.
  describe('admin-only delete affordance', () => {
    it('renders neither the Actions column nor a delete button for a basic USER', async () => {
      mockedReports.getFiltered.mockResolvedValue(paginated([makeIdea()]));
      const wrapper = mountPage();
      await flushPromises();

      expect(tableHeaders(wrapper)).not.toContain('Actions');
      expect(wrapper.find('.mdi-delete').exists()).toBe(false);
    });

    it('renders both the Actions column and a delete button for an ADMIN', async () => {
      const auth = useAuthStore();
      auth.user = { id: 'u1', name: 'Admin Ada', email: 'ada@x.com', role: Role.ADMIN };
      mockedReports.getFiltered.mockResolvedValue(paginated([makeIdea()]));
      const wrapper = mountPage();
      await flushPromises();

      expect(tableHeaders(wrapper)).toContain('Actions');
      expect(wrapper.find('.mdi-delete').exists()).toBe(true);
    });
  });

  describe('Jira column', () => {
    it('shows the Jira header column after Department', async () => {
      const wrapper = mountPage();
      await flushPromises();

      const headers = tableHeaders(wrapper);
      const deptIndex = headers.indexOf('Department');
      const jiraIndex = headers.indexOf('Jira');
      expect(deptIndex).toBeGreaterThanOrEqual(0);
      expect(jiraIndex).toBe(deptIndex + 1);
    });

    it("shows '-' for an idea that was never dispatched to Jira", async () => {
      mockedReports.getFiltered.mockResolvedValue(paginated([makeIdea()]));
      const wrapper = mountPage();
      await flushPromises();

      const row = wrapper.find('tbody tr');
      expect(row.text()).toContain('-');
    });

    it('shows just the key right after dispatch, before the first poll (no status yet)', async () => {
      mockedReports.getFiltered.mockResolvedValue(
        paginated([makeIdea({ status: IdeaStatus.APPROVED, jiraIssueKey: 'OPS-1', jiraStatus: null })])
      );
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.find('tbody tr').text()).toContain('OPS-1');
      expect(wrapper.find('tbody tr').text()).not.toContain('(');
    });

    it('shows the key with its raw status once known', async () => {
      mockedReports.getFiltered.mockResolvedValue(
        paginated([makeIdea({ jiraIssueKey: 'OPS-1', jiraStatus: 'In Review' })])
      );
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.find('tbody tr').text()).toContain('OPS-1 (In Review)');
    });
  });

  it('exports CSV without a submitterId for a basic USER', async () => {
    const wrapper = mountPage();
    await flushPromises();

    await clickExport(wrapper);

    expect(mockedReports.exportCSV).toHaveBeenCalledTimes(1);
    expect(mockedReports.exportCSV).toHaveBeenCalledWith({});
  });

  it('reports both counts when the export is capped by the page limit', async () => {
    mockedReports.getFiltered.mockResolvedValue(paginated([makeIdea()], 250));
    const wrapper = mountPage();
    await flushPromises();

    await clickExport(wrapper);

    // The snackbar renders in a teleported overlay, not inside the wrapper.
    expect(document.body.textContent).toContain(`Exported the first ${MAX_PAGE_LIMIT} of 250 ideas.`);
    // A capped export is not a plain success — it is flagged, like a rejection.
    expect(snackbarOf(wrapper).props('color')).toBe('info');
  });

  it('reports plain success when the export covers every match', async () => {
    mockedReports.getFiltered.mockResolvedValue(paginated([makeIdea()]));
    const wrapper = mountPage();
    await flushPromises();

    await clickExport(wrapper);

    expect(document.body.textContent).toContain('Report exported successfully!');
    expect(document.body.textContent).not.toContain('Exported the first');
    expect(snackbarOf(wrapper).props('color')).toBe('success');
  });

  // Boundary of the very same predicate the table notice uses: the export holds
  // MAX_PAGE_LIMIT rows, so exactly that many matches is a COMPLETE export.
  it('reports plain success when the export covers exactly a full page', async () => {
    mockedReports.getFiltered.mockResolvedValue(paginated(fullPage(), MAX_PAGE_LIMIT));
    const wrapper = mountPage();
    await flushPromises();

    await clickExport(wrapper);

    expect(document.body.textContent).toContain('Report exported successfully!');
    expect(document.body.textContent).not.toContain('Exported the first');
    expect(snackbarOf(wrapper).props('color')).toBe('success');
  });

  it('reports a capped export one match past a full page', async () => {
    mockedReports.getFiltered.mockResolvedValue(paginated(fullPage(), MAX_PAGE_LIMIT + 1));
    const wrapper = mountPage();
    await flushPromises();

    await clickExport(wrapper);

    expect(document.body.textContent).toContain(
      `Exported the first ${MAX_PAGE_LIMIT} of ${MAX_PAGE_LIMIT + 1} ideas.`
    );
    expect(snackbarOf(wrapper).props('color')).toBe('info');
  });
});
