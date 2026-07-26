import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import SubmitIdeaPage from '../pages/SubmitIdeaPage.vue';
import { Effort } from '../types';
import type { Department } from '../types';
import { createTestI18n, createTestVuetify } from './helpers';

vi.mock('../api/ideas', () => ({
  ideasApi: {
    getAll: vi.fn(),
    getOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../api/departments', () => ({
  departmentsApi: {
    getAll: vi.fn(),
    create: vi.fn(),
    rename: vi.fn(),
    reorder: vi.fn(),
    remove: vi.fn(),
  },
}));

import { ideasApi } from '../api/ideas';
import { departmentsApi } from '../api/departments';
const mockedIdeas = vi.mocked(ideasApi);
const mockedDepartments = vi.mocked(departmentsApi);

// Sorted by order: General (0) is the default preselection, Marketing (1) second.
const departments: Department[] = [
  { id: 'd1', name: 'General', order: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'd2', name: 'Marketing', order: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
];

interface FormData {
  title: string;
  description: string;
  benefits: string;
  effort: Effort | null;
  tags?: string[];
}

const validForm: FormData = {
  title: 'A valid idea title',
  description: 'This is a valid, long-enough description.',
  benefits: 'These are valid, long-enough benefits.',
  effort: Effort.ONE_TO_THREE_DAYS,
};

function mountPage() {
  return mount(SubmitIdeaPage, {
    global: { plugins: [createTestVuetify(), createTestI18n('en')] },
  });
}

async function fillForm(wrapper: VueWrapper, data: FormData) {
  wrapper.findComponent({ name: 'VTextField' }).vm.$emit('update:modelValue', data.title);
  const textareas = wrapper.findAllComponents({ name: 'VTextarea' });
  textareas[0].vm.$emit('update:modelValue', data.description);
  textareas[1].vm.$emit('update:modelValue', data.benefits);
  wrapper.findComponent({ name: 'VSelect' }).vm.$emit('update:modelValue', data.effort);
  if (data.tags) {
    wrapper.findComponent({ name: 'VCombobox' }).vm.$emit('update:modelValue', data.tags);
  }
  await flushPromises();
}

async function submit(wrapper: VueWrapper) {
  await wrapper.find('form').trigger('submit');
  await flushPromises();
}

describe('SubmitIdeaPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockedIdeas.create.mockResolvedValue({} as any);
    mockedDepartments.getAll.mockResolvedValue(departments);
  });

  it('renders the submission form and guidelines', () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain('Submit New Idea');
    expect(wrapper.text()).toContain('Submission Guidelines');
  });

  const invalidCases: Array<{ name: string; override: Partial<FormData>; error: string }> = [
    {
      name: 'title shorter than 5 chars',
      override: { title: 'abc' },
      error: 'Title must be at least 5 characters',
    },
    {
      name: 'title longer than 120 chars',
      override: { title: 'x'.repeat(121) },
      error: 'Title must be at most 120 characters',
    },
    {
      name: 'description shorter than 10 chars',
      override: { description: 'short' },
      error: 'Description must be at least 10 characters',
    },
    {
      name: 'benefits shorter than 10 chars',
      override: { benefits: 'short' },
      error: 'Benefits must be at least 10 characters',
    },
    {
      name: 'effort not selected',
      override: { effort: null },
      error: 'Effort estimation is required',
    },
  ];

  describe.each(invalidCases)('client-side validation blocks: $name', ({ override, error }) => {
    it('shows the error and does not call create', async () => {
      const wrapper = mountPage();
      await fillForm(wrapper, { ...validForm, ...override });
      await submit(wrapper);

      expect(wrapper.text()).toContain(error);
      expect(mockedIdeas.create).not.toHaveBeenCalled();
    });
  });

  it('blocks a fully empty submission with multiple errors', async () => {
    const wrapper = mountPage();
    await submit(wrapper);

    expect(wrapper.text()).toContain('Title must be at least 5 characters');
    expect(wrapper.text()).toContain('Description must be at least 10 characters');
    expect(wrapper.text()).toContain('Benefits must be at least 10 characters');
    expect(wrapper.text()).toContain('Effort estimation is required');
    expect(mockedIdeas.create).not.toHaveBeenCalled();
  });

  it('calls ideasApi.create with the payload (incl. preselected departmentId) and shows success', async () => {
    const wrapper = mountPage();
    await fillForm(wrapper, { ...validForm, tags: ['ux', 'perf'] });
    await submit(wrapper);

    expect(mockedIdeas.create).toHaveBeenCalledTimes(1);
    expect(mockedIdeas.create).toHaveBeenCalledWith({
      title: 'A valid idea title',
      description: 'This is a valid, long-enough description.',
      benefits: 'These are valid, long-enough benefits.',
      effort: Effort.ONE_TO_THREE_DAYS,
      departmentId: 'd1',
      tags: ['ux', 'perf'],
    });
    // NOTE: this page does not navigate on success (unlike the ticket wording);
    // it surfaces a success alert and resets the form instead.
    expect(wrapper.text()).toContain('Idea submitted successfully!');
  });

  it('fetches departments on mount and preselects the default (first-by-order)', async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(mockedDepartments.getAll).toHaveBeenCalledTimes(1);
    const departmentSelect = wrapper.findAllComponents({ name: 'VSelect' })[1];
    expect(departmentSelect.props('modelValue')).toBe('d1');
  });

  it('submits the chosen department when the user changes it', async () => {
    const wrapper = mountPage();
    await fillForm(wrapper, validForm);
    // Second VSelect is the department (first is effort).
    wrapper.findAllComponents({ name: 'VSelect' })[1].vm.$emit('update:modelValue', 'd2');
    await flushPromises();
    await submit(wrapper);

    expect(mockedIdeas.create).toHaveBeenCalledTimes(1);
    expect(mockedIdeas.create).toHaveBeenCalledWith(
      expect.objectContaining({ departmentId: 'd2' })
    );
  });

  it('blocks submission and shows a required error when no department is selected', async () => {
    const wrapper = mountPage();
    await fillForm(wrapper, validForm);
    // Clear the preselected department.
    wrapper.findAllComponents({ name: 'VSelect' })[1].vm.$emit('update:modelValue', null);
    await flushPromises();
    await submit(wrapper);

    expect(wrapper.text()).toContain('Department is required');
    expect(mockedIdeas.create).not.toHaveBeenCalled();
  });

  it('surfaces a server error message when create rejects', async () => {
    mockedIdeas.create.mockRejectedValueOnce({ response: { data: { error: 'Server exploded' } } });
    const wrapper = mountPage();
    await fillForm(wrapper, validForm);
    await submit(wrapper);

    expect(mockedIdeas.create).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Server exploded');
  });
});
