import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import UsersPage from '../pages/UsersPage.vue';
import { Role } from '../types';
import type { UserWithCounts } from '../types';
import { createTestI18n, createTestVuetify } from './helpers';

vi.mock('../api/users', () => ({
  usersApi: {
    getAll: vi.fn(),
    getOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

import { usersApi } from '../api/users';
const mockedUsers = vi.mocked(usersApi);

const localUser: UserWithCounts = {
  id: 'u1',
  name: 'Local Larry',
  email: 'larry@x.com',
  role: Role.USER,
  _count: { submittedIdeas: 2, approvedIdeas: 0, assignedIdeas: 1 },
};

const ssoUser: UserWithCounts = {
  id: 'u2',
  name: 'Sso Sally',
  email: 'sally@x.com',
  role: Role.ADMIN,
  authProvider: 'SSO',
  _count: { submittedIdeas: 5, approvedIdeas: 3, assignedIdeas: 0 },
};

function mountPage() {
  return mount(UsersPage, {
    global: { plugins: [createTestVuetify(), createTestI18n('en')] },
  });
}

function editButtons(wrapper: VueWrapper) {
  return wrapper.findAll('.v-btn').filter((b) => b.html().includes('mdi-pencil'));
}

describe('UsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUsers.getAll.mockResolvedValue([localUser, ssoUser]);
  });

  it('loads users on mount and renders a row per user', async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(mockedUsers.getAll).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Local Larry');
    expect(wrapper.text()).toContain('larry@x.com');
    expect(wrapper.text()).toContain('Sso Sally');
    expect(wrapper.text()).toContain('sally@x.com');
  });

  it('shows exactly one SSO chip, on the SSO user row', async () => {
    const wrapper = mountPage();
    await flushPromises();

    const ssoChips = wrapper.findAll('.v-chip').filter((c) => c.text().trim() === 'SSO');
    expect(ssoChips).toHaveLength(1);
  });

  it('renders role chips for both users', async () => {
    const wrapper = mountPage();
    await flushPromises();
    const chipTexts = wrapper.findAll('.v-chip').map((c) => c.text().trim());
    expect(chipTexts).toContain('USER');
    expect(chipTexts).toContain('ADMIN');
  });

  it('disables the edit button for the SSO user and enables it for the LOCAL user', async () => {
    const wrapper = mountPage();
    await flushPromises();

    const edits = editButtons(wrapper);
    expect(edits).toHaveLength(2);
    const disabled = edits.filter((b) => b.classes().includes('v-btn--disabled'));
    const enabled = edits.filter((b) => !b.classes().includes('v-btn--disabled'));
    expect(disabled).toHaveLength(1); // SSO user
    expect(enabled).toHaveLength(1); // LOCAL user
  });

  it('opens the edit dialog when the LOCAL user edit button is clicked', async () => {
    const wrapper = mountPage();
    await flushPromises();

    const dialogs = wrapper.findAllComponents({ name: 'VDialog' });
    // dialogs: [0]=create, [1]=edit, [2]=delete
    expect(dialogs[1].props('modelValue')).toBe(false);

    const enabledEdit = editButtons(wrapper).find(
      (b) => !b.classes().includes('v-btn--disabled')
    );
    await enabledEdit!.trigger('click');
    await flushPromises();

    expect(dialogs[1].props('modelValue')).toBe(true);
    expect(document.body.textContent).toContain('Edit User');
  });

  // isSso() treats both null and undefined authProvider as LOCAL (editable).
  const localCases: Array<{ label: string; authProvider: 'LOCAL' | null | undefined }> = [
    { label: 'undefined authProvider', authProvider: undefined },
    { label: 'null authProvider', authProvider: null },
    { label: 'explicit LOCAL authProvider', authProvider: 'LOCAL' },
  ];

  describe.each(localCases)('LOCAL user with $label', ({ authProvider }) => {
    it('is editable (no SSO chip, enabled edit button)', async () => {
      mockedUsers.getAll.mockResolvedValue([{ ...localUser, authProvider }]);
      const wrapper = mountPage();
      await flushPromises();

      const ssoChips = wrapper.findAll('.v-chip').filter((c) => c.text().trim() === 'SSO');
      expect(ssoChips).toHaveLength(0);

      const edits = editButtons(wrapper);
      expect(edits).toHaveLength(1);
      expect(edits[0].classes()).not.toContain('v-btn--disabled');
    });
  });

  it('opens the create dialog from the Create User button', async () => {
    const wrapper = mountPage();
    await flushPromises();

    const dialogs = wrapper.findAllComponents({ name: 'VDialog' });
    expect(dialogs[0].props('modelValue')).toBe(false);

    const createBtn = wrapper.findAll('.v-btn').find((b) => b.text().trim() === 'Create User');
    await createBtn!.trigger('click');
    await flushPromises();

    expect(dialogs[0].props('modelValue')).toBe(true);
  });
});
