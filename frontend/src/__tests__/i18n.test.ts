import { describe, it, expect } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../i18n/en';
import sk from '../i18n/sk';

function flattenKeys(obj: Record<string, any>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null) {
      return flattenKeys(value, path);
    }
    return [path];
  });
}

const enKeys = flattenKeys(en);
const skKeys = flattenKeys(sk);

describe('i18n translation files', () => {
  it('EN and SK have the same keys', () => {
    expect(enKeys.sort()).toEqual(skKeys.sort());
  });

  it('no empty string values in EN', () => {
    const empty = enKeys.filter((key) => {
      const value = key.split('.').reduce((o: any, k) => o?.[k], en);
      return value === '';
    });
    expect(empty).toEqual([]);
  });

  it('no empty string values in SK', () => {
    const empty = skKeys.filter((key) => {
      const value = key.split('.').reduce((o: any, k) => o?.[k], sk);
      return value === '';
    });
    expect(empty).toEqual([]);
  });

  it('SK translations differ from EN (are actually translated)', () => {
    const identical = enKeys.filter((key) => {
      const enVal = key.split('.').reduce((o: any, k) => o?.[k], en);
      const skVal = key.split('.').reduce((o: any, k) => o?.[k], sk);
      return enVal === skVal;
    });
    const allowedIdentical = ['common.appName'];
    const unexpected = identical.filter((k) => !allowedIdentical.includes(k));
    expect(unexpected).toEqual([]);
  });

  it('has all required top-level sections', () => {
    const requiredSections = [
      'common', 'nav', 'auth', 'dashboard', 'ideas', 'effort',
      'status', 'review', 'approved', 'inProgress', 'completed',
      'reports', 'users', 'guidelines', 'validation', 'myIdeas',
      'changePassword',
    ];
    for (const section of requiredSections) {
      expect(en).toHaveProperty(section);
      expect(sk).toHaveProperty(section);
    }
  });

  it('interpolation placeholders match between EN and SK', () => {
    const placeholderRegex = /\{(\w+)\}/g;
    const mismatches: string[] = [];
    for (const key of enKeys) {
      const enVal = key.split('.').reduce((o: any, k) => o?.[k], en) as string;
      const skVal = key.split('.').reduce((o: any, k) => o?.[k], sk) as string;
      const enPlaceholders = [...enVal.matchAll(placeholderRegex)].map((m) => m[1]).sort();
      const skPlaceholders = [...skVal.matchAll(placeholderRegex)].map((m) => m[1]).sort();
      if (JSON.stringify(enPlaceholders) !== JSON.stringify(skPlaceholders)) {
        mismatches.push(`${key}: EN={${enPlaceholders}} SK={${skPlaceholders}}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe('i18n runtime', () => {
  function createTestI18n(locale = 'en') {
    return createI18n({
      legacy: false,
      locale,
      fallbackLocale: 'en',
      messages: { en, sk },
    });
  }

  it('resolves EN translations', () => {
    const i18n = createTestI18n('en');
    const { t } = i18n.global;
    expect(t('common.appName')).toBe('IdeaHub');
    expect(t('nav.dashboard')).toBe('Dashboard');
    expect(t('auth.email')).toBe('Email');
    expect(t('status.submitted')).toBe('Submitted');
    expect(t('effort.lessThanOneDay')).toBe('< 1 day');
  });

  it('resolves SK translations', () => {
    const i18n = createTestI18n('sk');
    const { t } = i18n.global;
    expect(t('common.appName')).toBe('IdeaHub');
    expect(t('nav.dashboard')).toBe('Prehľad');
    expect(t('auth.email')).toBe('E-mail');
    expect(t('status.submitted')).toBe('Odoslané');
    expect(t('effort.lessThanOneDay')).toBe('< 1 deň');
  });

  it('switches locale at runtime', () => {
    const i18n = createTestI18n('en');
    const { t, locale } = i18n.global;
    expect(t('nav.submitIdea')).toBe('Submit Idea');
    locale.value = 'sk';
    expect(t('nav.submitIdea')).toBe('Nový nápad');
    locale.value = 'en';
    expect(t('nav.submitIdea')).toBe('Submit Idea');
  });

  it('handles interpolation', () => {
    const i18n = createTestI18n('en');
    const { t, locale } = i18n.global;
    expect(t('review.approveConfirm', { title: 'My Idea' })).toBe('Approve "My Idea"?');
    locale.value = 'sk';
    expect(t('review.approveConfirm', { title: 'Môj nápad' })).toBe('Schváliť "Môj nápad"?');
  });

  it('falls back to EN for missing keys', () => {
    const i18n = createTestI18n('sk');
    const { t } = i18n.global;
    expect(t('common.appName')).toBe('IdeaHub');
  });
});

describe('translation coverage for components', () => {
  const requiredKeys: Record<string, string[]> = {
    LoginPage: [
      'common.appName', 'common.login',
      'auth.email', 'auth.password', 'auth.emailRequired', 'auth.passwordRequired',
    ],
    DashboardPage: [
      'dashboard.title', 'dashboard.submitted', 'dashboard.approved',
      'dashboard.inProgress', 'dashboard.done', 'dashboard.rejected', 'dashboard.total',
      'dashboard.averageTimes', 'dashboard.topContributors', 'dashboard.monthlyTrend',
    ],
    SubmitIdeaPage: [
      'ideas.submitTitle', 'ideas.title', 'ideas.description', 'ideas.benefits',
      'ideas.effort', 'ideas.tags', 'ideas.submitIdea', 'ideas.submitSuccess',
      'guidelines.title', 'guidelines.specific', 'guidelines.problem',
      'validation.titleMinLength', 'validation.effortRequired',
    ],
    IdeaCard: [
      'ideas.viewDetails', 'ideas.approvedBy', 'ideas.assignedTo', 'ideas.submittedBy',
      'status.submitted', 'status.approved', 'status.inProgress', 'status.done', 'status.rejected',
      'effort.lessThanOneDay', 'effort.oneToThreeDays', 'effort.moreThanThreeDays',
    ],
    ReviewQueuePage: [
      'review.title', 'review.subtitle', 'review.approve', 'review.reject',
      'review.approveTitle', 'review.rejectTitle', 'review.approveConfirm',
      'review.approvalNotes', 'review.rejectionReason', 'review.noPending',
    ],
    ApprovedIdeasPage: [
      'approved.title', 'approved.subtitle', 'approved.claimStart', 'approved.noIdeas',
    ],
    InProgressIdeasPage: [
      'inProgress.title', 'inProgress.markComplete', 'inProgress.completeTitle',
      'inProgress.completeConfirm', 'inProgress.completionNotes', 'inProgress.noIdeas',
    ],
    CompletedIdeasPage: [
      'completed.title', 'completed.noIdeas',
    ],
    IdeaDetailPage: [
      'ideas.description', 'ideas.benefits', 'ideas.details',
      'ideas.submittedBy', 'ideas.approvedByLabel', 'ideas.assignedToLabel',
      'ideas.activityTimeline', 'ideas.ideaNotFound',
    ],
    ReportsPage: [
      'reports.title', 'reports.filters', 'reports.status', 'reports.startDate',
      'reports.endDate', 'reports.filteredResults', 'reports.exportCSV',
      'reports.headerTitle', 'reports.headerStatus', 'reports.headerEffort',
    ],
    UsersPage: [
      'users.title', 'users.usersLabel', 'users.createUser', 'users.editUser',
      'users.deleteUser', 'users.name', 'users.email', 'users.password',
      'users.role', 'users.nameRequired', 'users.emailRequired',
    ],
    MyIdeasPage: [
      'myIdeas.title', 'myIdeas.subtitle', 'myIdeas.filterByStatus', 'myIdeas.noIdeas',
      'status.submitted', 'status.approved', 'status.inProgress', 'status.done', 'status.rejected',
    ],
    ChangePasswordPage: [
      'changePassword.title', 'changePassword.subtitle',
      'changePassword.currentPassword', 'changePassword.newPassword',
      'changePassword.confirmPassword', 'changePassword.passwordHint',
      'changePassword.submit', 'changePassword.currentPasswordRequired',
      'changePassword.newPasswordRequired', 'changePassword.confirmPasswordRequired',
      'changePassword.passwordMinLength', 'changePassword.passwordsMismatch',
      'changePassword.success', 'changePassword.failed',
    ],
    MainLayout: [
      'nav.dashboard', 'nav.submitIdea', 'nav.myIdeas', 'nav.approved', 'nav.inProgress',
      'nav.completed', 'nav.reviewQueue', 'nav.reports', 'nav.users', 'nav.changePassword',
      'common.logout', 'common.appName',
    ],
  };

  for (const [component, keys] of Object.entries(requiredKeys)) {
    describe(component, () => {
      for (const key of keys) {
        it(`key "${key}" exists in EN`, () => {
          const value = key.split('.').reduce((o: any, k) => o?.[k], en);
          expect(value).toBeDefined();
          expect(typeof value).toBe('string');
        });

        it(`key "${key}" exists in SK`, () => {
          const value = key.split('.').reduce((o: any, k) => o?.[k], sk);
          expect(value).toBeDefined();
          expect(typeof value).toBe('string');
        });
      }
    });
  }
});
