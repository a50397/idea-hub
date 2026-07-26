import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import DepartmentsPage from '../pages/DepartmentsPage.vue';
import type { Department } from '../types';
import { createTestI18n, createTestVuetify } from './helpers';

vi.mock('../api/departments', () => ({
  departmentsApi: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    reorder: vi.fn(),
    remove: vi.fn(),
  },
}));

import { departmentsApi } from '../api/departments';
const mockedApi = vi.mocked(departmentsApi);

function dept(id: string, name: string, order: number, ideas = 0, notificationEmails?: string[]): Department {
  return {
    id,
    name,
    order,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...(notificationEmails ? { notificationEmails } : {}),
    _count: { ideas },
  };
}

// Returned unsorted on purpose: the store/getters must sort by order.
const unsorted: Department[] = [
  dept('charlie', 'Charlie', 2, 1),
  dept('alpha', 'Alpha', 0, 4),
  dept('bravo', 'Bravo', 1, 2),
];

function mountPage() {
  return mount(DepartmentsPage, {
    global: { plugins: [createTestVuetify(), createTestI18n('en')] },
  });
}

// Row action buttons live inline in the data table (not teleported).
function rowButtons(wrapper: VueWrapper, icon: string) {
  return wrapper.findAll('.v-btn').filter((b) => b.html().includes(icon));
}

// Dialog buttons are teleported to body; reach them through the component tree.
function dialogButton(wrapper: VueWrapper, label: string) {
  return wrapper.findAllComponents({ name: 'VBtn' }).find((b) => b.text().trim() === label);
}

// The create dialog's name field is the LAST VTextField in tree order — the
// data-table footer's items-per-page control is itself a VTextField and comes first.
function setDialogName(wrapper: VueWrapper, value: string) {
  const fields = wrapper.findAllComponents({ name: 'VTextField' });
  fields[fields.length - 1].vm.$emit('update:modelValue', value);
}

// In the EDIT dialog the notification-emails VCombobox also renders an internal
// VTextField, so "last VTextField" is ambiguous — target the name field by its
// label instead ("Name *"; the combobox's label never contains "Name").
function setEditName(wrapper: VueWrapper, value: string) {
  const field = wrapper
    .findAllComponents({ name: 'VTextField' })
    .find((f) => String(f.props('label') ?? '').includes('Name'));
  field!.vm.$emit('update:modelValue', value);
}

function editCombobox(wrapper: VueWrapper) {
  return wrapper.findComponent({ name: 'VCombobox' });
}

function setEditEmails(wrapper: VueWrapper, value: string[]) {
  editCombobox(wrapper).vm.$emit('update:modelValue', value);
}

// The combobox's real <input>. A native keydown is used (below) so the event can
// carry key/composition flags and expose defaultPrevented — neither of which
// @vue/test-utils' trigger() surfaces.
function comboboxInput(wrapper: VueWrapper): HTMLInputElement {
  return editCombobox(wrapper).find('input').element as HTMLInputElement;
}

// Simulate typing a not-yet-committed address into the combobox's search field so
// Vuetify has pending text to turn into a chip on Enter.
function typeInEmails(wrapper: VueWrapper, text: string): HTMLInputElement {
  const input = comboboxInput(wrapper);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input;
}

// Dispatch a native Enter keydown on the field and return the event so the caller
// can read defaultPrevented. `isComposing` reproduces the fast-typing IME state in
// which Vuetify's own combobox handler bails out and skips its own preventDefault.
function pressEnter(input: HTMLInputElement, isComposing = false): KeyboardEvent {
  const ev = new window.KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    bubbles: true,
    cancelable: true,
    isComposing,
  });
  input.dispatchEvent(ev);
  return ev;
}

describe('DepartmentsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockedApi.getAll.mockResolvedValue(unsorted);
  });

  it('loads departments on mount and renders them sorted by order with ideas counts', async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(mockedApi.getAll).toHaveBeenCalledTimes(1);
    const rows = wrapper.findAll('tbody tr');
    expect(rows).toHaveLength(3);
    expect(rows[0].text()).toContain('Alpha');
    expect(rows[1].text()).toContain('Bravo');
    expect(rows[2].text()).toContain('Charlie');
    // _count.ideas is surfaced for the first (Alpha) row.
    expect(rows[0].text()).toContain('4');
  });

  it('creates a department through the create dialog', async () => {
    mockedApi.create.mockResolvedValueOnce(dept('new', 'New Team', 3));
    const wrapper = mountPage();
    await flushPromises();

    const opener = wrapper.findAll('.v-btn').find((b) => b.text().trim() === 'Create Department');
    await opener!.trigger('click');
    await flushPromises();

    setDialogName(wrapper, 'New Team');
    await flushPromises();

    await dialogButton(wrapper, 'Create')!.trigger('click');
    await flushPromises();

    expect(mockedApi.create).toHaveBeenCalledWith('New Team');
  });

  it('blocks creation with a required error when the name is empty', async () => {
    const wrapper = mountPage();
    await flushPromises();

    const opener = wrapper.findAll('.v-btn').find((b) => b.text().trim() === 'Create Department');
    await opener!.trigger('click');
    await flushPromises();

    await dialogButton(wrapper, 'Create')!.trigger('click');
    await flushPromises();

    expect(mockedApi.create).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Department name is required');
  });

  it('updates a department name and notification emails through the edit dialog', async () => {
    mockedApi.update.mockResolvedValueOnce(dept('alpha', 'Renamed', 0));
    const wrapper = mountPage();
    await flushPromises();

    // First row (Alpha) pencil button.
    await rowButtons(wrapper, 'mdi-pencil')[0].trigger('click');
    await flushPromises();

    setEditName(wrapper, 'Renamed');
    setEditEmails(wrapper, ['ops@corp.example', 'lead@corp.example']);
    await flushPromises();

    await dialogButton(wrapper, 'Update')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).toHaveBeenCalledWith('alpha', {
      name: 'Renamed',
      notificationEmails: ['ops@corp.example', 'lead@corp.example'],
    });
  });

  it('pre-fills the edit dialog with existing notification emails and can remove one', async () => {
    mockedApi.getAll.mockResolvedValue([
      dept('alpha', 'Alpha', 0, 0, ['keep@corp.example', 'drop@corp.example']),
    ]);
    mockedApi.update.mockResolvedValueOnce(dept('alpha', 'Alpha', 0));
    const wrapper = mountPage();
    await flushPromises();

    await rowButtons(wrapper, 'mdi-pencil')[0].trigger('click');
    await flushPromises();

    // The combobox is pre-populated from the department's stored addresses.
    expect(editCombobox(wrapper).props('modelValue')).toEqual([
      'keep@corp.example',
      'drop@corp.example',
    ]);

    // Remove one address, then save.
    setEditEmails(wrapper, ['keep@corp.example']);
    await flushPromises();
    await dialogButton(wrapper, 'Update')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).toHaveBeenCalledWith('alpha', {
      name: 'Alpha',
      notificationEmails: ['keep@corp.example'],
    });
  });

  it('blocks the save and shows a validation message when a notification email is invalid', async () => {
    const wrapper = mountPage();
    await flushPromises();

    await rowButtons(wrapper, 'mdi-pencil')[0].trigger('click');
    await flushPromises();

    setEditEmails(wrapper, ['not-an-email']);
    await flushPromises();

    await dialogButton(wrapper, 'Update')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('One or more email addresses are invalid');
  });

  it('blocks the save and shows a validation message when more than 20 notification emails are entered', async () => {
    const wrapper = mountPage();
    await flushPromises();

    await rowButtons(wrapper, 'mdi-pencil')[0].trigger('click');
    await flushPromises();

    // 21 otherwise-valid addresses exceed the backend cap of 20.
    const many = Array.from({ length: 21 }, (_, i) => `user${i}@corp.example`);
    setEditEmails(wrapper, many);
    await flushPromises();

    await dialogButton(wrapper, 'Update')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('At most 20 notification emails are allowed');
  });

  it('splits a comma/whitespace-separated paste into individual email chips', async () => {
    const wrapper = mountPage();
    await flushPromises();

    await rowButtons(wrapper, 'mdi-pencil')[0].trigger('click');
    await flushPromises();

    // A pasted list arrives as ONE combobox entry; it must fan out into chips.
    setEditEmails(wrapper, ['a@x.com, b@y.com']);
    await flushPromises();

    expect(editCombobox(wrapper).props('modelValue')).toEqual(['a@x.com', 'b@y.com']);
  });

  it('drops whitespace-only fragments when splitting a pasted email list', async () => {
    const wrapper = mountPage();
    await flushPromises();

    await rowButtons(wrapper, 'mdi-pencil')[0].trigger('click');
    await flushPromises();

    // Double separators and trailing spaces produce empty fragments that are dropped.
    setEditEmails(wrapper, ['a@x.com , , b@y.com,  ']);
    await flushPromises();

    expect(editCombobox(wrapper).props('modelValue')).toEqual(['a@x.com', 'b@y.com']);
  });

  it('commits a chip on Enter in the emails combobox without saving or closing the dialog', async () => {
    const wrapper = mountPage();
    await flushPromises();

    await rowButtons(wrapper, 'mdi-pencil')[0].trigger('click');
    await flushPromises();

    // Type an address but do NOT press Update; Enter should only turn it into a chip.
    const input = typeInEmails(wrapper, 'ops@corp.example');
    await flushPromises();

    const ev = pressEnter(input);
    await flushPromises();

    // Vuetify's own Enter handling still commits the typed text as a chip...
    expect(editCombobox(wrapper).props('modelValue')).toEqual(['ops@corp.example']);
    // ...while the browser's implicit form submission (Enter's default action) is
    // prevented, so the edit form never submits: update is not called and the
    // dialog (its Update button) stays open. This is the root-cause UX bug.
    expect(ev.defaultPrevented).toBe(true);
    expect(mockedApi.update).not.toHaveBeenCalled();
    expect(dialogButton(wrapper, 'Update')).toBeTruthy();
  });

  it('blocks Enter from submitting the edit form even when the keydown is mid-composition', async () => {
    const wrapper = mountPage();
    await flushPromises();

    await rowButtons(wrapper, 'mdi-pencil')[0].trigger('click');
    await flushPromises();

    const input = typeInEmails(wrapper, 'lead@corp.example');
    await flushPromises();

    // Reproduces the e2e flake: after real per-key typing, the Enter keydown can
    // still report isComposing=true. Vuetify's combobox handler then returns early
    // and skips ITS preventDefault, so without the field's own @keydown.enter.prevent
    // the browser would implicitly submit the form and save-and-close the dialog.
    const ev = pressEnter(input, true);
    await flushPromises();

    expect(ev.defaultPrevented).toBe(true);
    expect(mockedApi.update).not.toHaveBeenCalled();
    expect(dialogButton(wrapper, 'Update')).toBeTruthy();
  });

  it('surfaces a backend 409 when a delete is blocked', async () => {
    mockedApi.remove.mockRejectedValueOnce({
      response: { data: { error: 'Cannot delete a department that still has ideas' } },
    });
    const wrapper = mountPage();
    await flushPromises();

    await rowButtons(wrapper, 'mdi-delete')[0].trigger('click');
    await flushPromises();

    await dialogButton(wrapper, 'Delete')!.trigger('click');
    await flushPromises();

    expect(mockedApi.remove).toHaveBeenCalledWith('alpha');
    expect(document.body.textContent).toContain('Cannot delete a department that still has ideas');
  });

  it('sends the full id permutation when moving a row down', async () => {
    mockedApi.reorder.mockResolvedValueOnce([
      dept('bravo', 'Bravo', 0, 2),
      dept('alpha', 'Alpha', 1, 4),
      dept('charlie', 'Charlie', 2, 1),
    ]);
    const wrapper = mountPage();
    await flushPromises();

    // Move the first row (Alpha) down → swaps Alpha and Bravo.
    await rowButtons(wrapper, 'mdi-arrow-down')[0].trigger('click');
    await flushPromises();

    expect(mockedApi.reorder).toHaveBeenCalledTimes(1);
    expect(mockedApi.reorder).toHaveBeenCalledWith(['bravo', 'alpha', 'charlie']);
  });

  it('sends the full id permutation when moving a row up', async () => {
    mockedApi.reorder.mockResolvedValueOnce([
      dept('alpha', 'Alpha', 0, 4),
      dept('charlie', 'Charlie', 1, 1),
      dept('bravo', 'Bravo', 2, 2),
    ]);
    const wrapper = mountPage();
    await flushPromises();

    // Move the last row (Charlie) up → swaps Bravo and Charlie.
    await rowButtons(wrapper, 'mdi-arrow-up')[2].trigger('click');
    await flushPromises();

    expect(mockedApi.reorder).toHaveBeenCalledTimes(1);
    expect(mockedApi.reorder).toHaveBeenCalledWith(['alpha', 'charlie', 'bravo']);
  });

  it('disables move-up on the first row and move-down on the last row', async () => {
    const wrapper = mountPage();
    await flushPromises();

    const ups = rowButtons(wrapper, 'mdi-arrow-up');
    const downs = rowButtons(wrapper, 'mdi-arrow-down');
    expect(ups).toHaveLength(3);
    expect(downs).toHaveLength(3);
    expect(ups[0].classes()).toContain('v-btn--disabled'); // first row
    expect(downs[2].classes()).toContain('v-btn--disabled'); // last row
    expect(ups[1].classes()).not.toContain('v-btn--disabled');
    expect(downs[0].classes()).not.toContain('v-btn--disabled');
  });
});
