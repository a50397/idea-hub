import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import DashboardPage from '../pages/DashboardPage.vue';
import { useAuthStore } from '../stores/auth';
import { Role } from '../types';
import type { DashboardSummary, MonthlyTrend, DepartmentReport, TopContributor } from '../types';
import { createTestI18n, createTestVuetify } from './helpers';

// happy-dom (like jsdom) has no canvas, so chart.js cannot actually render;
// stub the vue-chartjs Bar component and assert on the stub + the props it
// received instead of canvas internals.
vi.mock('vue-chartjs', () => ({
  Bar: {
    name: 'Bar',
    props: ['data', 'options'],
    template: '<div class="bar-chart-stub" />',
  },
}));

vi.mock('../api/reports', () => ({
  reportsApi: {
    getSummary: vi.fn(),
    getMonthlyTrend: vi.fn(),
    getTopContributors: vi.fn(),
    getByDepartment: vi.fn(),
  },
}));

import { reportsApi } from '../api/reports';
const mockedReports = vi.mocked(reportsApi);

const summary: DashboardSummary = {
  counts: { submitted: 12, approved: 8, inProgress: 4, done: 6, rejected: 2, total: 32 },
  averageTimes: { submittedToApprovedDays: 3, approvedToDoneDays: 9 },
};

const monthlyTrend: MonthlyTrend[] = [
  { month: '2026-01', count: 3 },
  { month: '2026-02', count: 5 },
];

const byDepartment: DepartmentReport[] = [
  { departmentId: 'd1', name: 'General', count: 4 },
  { departmentId: 'd2', name: 'Marketing', count: 6 },
];

const topContributors: TopContributor[] = [
  { userId: 'u1', userName: 'Alice', userEmail: 'alice@x.com', completedIdeas: 7 },
];

function mountPage() {
  const i18n = createTestI18n('en');
  const wrapper = mount(DashboardPage, {
    global: { plugins: [createTestVuetify(), i18n] },
  });
  return { wrapper, i18n };
}

// Finds the top-level v-card whose v-card-title text matches exactly (stat
// cards have no title, so this only ever matches the section cards).
function cardByTitle(wrapper: VueWrapper, title: string) {
  return wrapper.findAll('.v-card').find((card) => {
    const cardTitle = card.find('.v-card-title');
    return cardTitle.exists() && cardTitle.text() === title;
  });
}

// createTestI18n()'s declared return type is the generic `I18n` interface, so
// `.global.t` resolves to a union of incompatible composer overloads that TS
// refuses to call directly (TS2349). Narrow it to the single string-key
// overload every test below actually uses.
function translator(i18n: ReturnType<typeof createTestI18n>) {
  return i18n.global.t as (key: string) => string;
}

describe('DashboardPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockedReports.getSummary.mockResolvedValue(summary);
    mockedReports.getMonthlyTrend.mockResolvedValue(monthlyTrend);
    mockedReports.getByDepartment.mockResolvedValue(byDepartment);
    mockedReports.getTopContributors.mockResolvedValue(topContributors);
    const auth = useAuthStore();
    auth.user = { id: 'u0', name: 'Employee Ellie', email: 'ellie@x.com', role: Role.USER };
  });

  it('renders the six stat counts from the mocked summary', async () => {
    const { wrapper, i18n } = mountPage();
    await flushPromises();
    const t = translator(i18n);

    const cards = wrapper.findAll('.stat-card');
    expect(cards).toHaveLength(6);

    const expected: Array<[string, number]> = [
      [t('dashboard.submitted'), summary.counts.submitted],
      [t('dashboard.approved'), summary.counts.approved],
      [t('dashboard.inProgress'), summary.counts.inProgress],
      [t('dashboard.done'), summary.counts.done],
      [t('dashboard.rejected'), summary.counts.rejected],
      [t('dashboard.total'), summary.counts.total],
    ];

    expected.forEach(([label, count], index) => {
      const card = cards[index];
      expect(card.find('.text-overline').text()).toBe(label);
      expect(card.find('.text-h4').text()).toBe(String(count));
    });
  });

  it('renders the average times values with the days label', async () => {
    const { wrapper, i18n } = mountPage();
    await flushPromises();
    const t = translator(i18n);

    const subtitles = wrapper.findAll('.v-list-item-subtitle');
    expect(subtitles[0].text()).toBe(
      `${summary.averageTimes.submittedToApprovedDays} ${t('dashboard.days')}`
    );
    expect(subtitles[1].text()).toBe(
      `${summary.averageTimes.approvedToDoneDays} ${t('dashboard.days')}`
    );
  });

  it('shows the department bar chart when getByDepartment returns items', async () => {
    const { wrapper, i18n } = mountPage();
    await flushPromises();
    const t = translator(i18n);

    const card = cardByTitle(wrapper, t('dashboard.ideasByDepartment'));
    expect(card).toBeTruthy();
    expect(card!.text()).not.toContain(t('dashboard.noDepartmentData'));

    const bar = card!.findComponent({ name: 'Bar' });
    expect(bar.exists()).toBe(true);
    expect((bar.props('data') as any).labels).toEqual(byDepartment.map((d) => d.name));
  });

  it('shows the noDepartmentData empty state when getByDepartment returns []', async () => {
    mockedReports.getByDepartment.mockResolvedValueOnce([]);
    const { wrapper, i18n } = mountPage();
    await flushPromises();
    const t = translator(i18n);

    const card = cardByTitle(wrapper, t('dashboard.ideasByDepartment'));
    expect(card).toBeTruthy();
    expect(card!.findComponent({ name: 'Bar' }).exists()).toBe(false);
    expect(card!.text()).toContain(t('dashboard.noDepartmentData'));
  });

  it('shows the monthly trend bar chart when getMonthlyTrend returns items', async () => {
    const { wrapper, i18n } = mountPage();
    await flushPromises();
    const t = translator(i18n);

    const card = cardByTitle(wrapper, t('dashboard.monthlyTrend'));
    expect(card).toBeTruthy();
    expect(card!.text()).not.toContain(t('dashboard.noTrendData'));

    const bar = card!.findComponent({ name: 'Bar' });
    expect(bar.exists()).toBe(true);
    expect((bar.props('data') as any).labels).toEqual(monthlyTrend.map((m) => m.month));
  });

  it('shows the noTrendData empty state when getMonthlyTrend returns []', async () => {
    mockedReports.getMonthlyTrend.mockResolvedValueOnce([]);
    const { wrapper, i18n } = mountPage();
    await flushPromises();
    const t = translator(i18n);

    const card = cardByTitle(wrapper, t('dashboard.monthlyTrend'));
    expect(card).toBeTruthy();
    expect(card!.findComponent({ name: 'Bar' }).exists()).toBe(false);
    expect(card!.text()).toContain(t('dashboard.noTrendData'));
  });

  describe.each([{ role: Role.POWER_USER }, { role: Role.ADMIN }] as const)(
    'Top Contributors card for $role',
    ({ role }) => {
      it('is shown and getTopContributors is called with the top-5 limit', async () => {
        const auth = useAuthStore();
        auth.user = { id: 'u1', name: 'Power Pat', email: 'pat@x.com', role };

        const { wrapper, i18n } = mountPage();
        await flushPromises();
        const t = translator(i18n);

        const card = cardByTitle(wrapper, t('dashboard.topContributors'));
        expect(card).toBeTruthy();
        expect(card!.text()).toContain('Alice');
        expect(mockedReports.getTopContributors).toHaveBeenCalledTimes(1);
        expect(mockedReports.getTopContributors).toHaveBeenCalledWith(5);
      });
    }
  );

  it('hides the Top Contributors card for a regular (non power) user and does not call getTopContributors', async () => {
    const auth = useAuthStore();
    auth.user = { id: 'u2', name: 'Employee Ellie', email: 'ellie@x.com', role: Role.USER };

    const { wrapper, i18n } = mountPage();
    await flushPromises();
    const t = translator(i18n);

    expect(cardByTitle(wrapper, t('dashboard.topContributors'))).toBeUndefined();
    expect(mockedReports.getTopContributors).not.toHaveBeenCalled();
  });

  it('mounts without throwing and renders 0 for every stat when getSummary rejects', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedReports.getSummary.mockRejectedValueOnce(new Error('summary boom'));

    // Promise.all fails fast on the first rejection, so monthlyTrend/byDepartment
    // never get assigned either, even though those two calls would have resolved.
    const { wrapper } = mountPage();
    await flushPromises();

    expect(wrapper.find('.v-progress-circular').exists()).toBe(false);
    const cards = wrapper.findAll('.stat-card');
    expect(cards).toHaveLength(6);
    cards.forEach((card) => {
      expect(card.find('.text-h4').text()).toBe('0');
    });

    consoleSpy.mockRestore();
  });
});
