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
    rename: vi.fn(),
    reorder: vi.fn(),
    remove: vi.fn(),
  },
}));

import { departmentsApi } from '../api/departments';
const mockedApi = vi.mocked(departmentsApi);

function dept(id: string, name: string, order: number, ideas = 0): Department {
  return {
    id,
    name,
    order,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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

// The dialog's name field is the LAST VTextField in tree order — the data-table
// footer's items-per-page control is itself a VTextField and comes first.
function setDialogName(wrapper: VueWrapper, value: string) {
  const fields = wrapper.findAllComponents({ name: 'VTextField' });
  fields[fields.length - 1].vm.$emit('update:modelValue', value);
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

  it('renames a department through the edit dialog', async () => {
    mockedApi.rename.mockResolvedValueOnce(dept('alpha', 'Renamed', 0));
    const wrapper = mountPage();
    await flushPromises();

    // First row (Alpha) pencil button.
    await rowButtons(wrapper, 'mdi-pencil')[0].trigger('click');
    await flushPromises();

    setDialogName(wrapper, 'Renamed');
    await flushPromises();

    await dialogButton(wrapper, 'Update')!.trigger('click');
    await flushPromises();

    expect(mockedApi.rename).toHaveBeenCalledWith('alpha', 'Renamed');
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
