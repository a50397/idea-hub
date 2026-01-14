import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import IdeaCard from '../IdeaCard.vue';
import type { Idea } from '@/types';

// Mock vue-i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe('IdeaCard', () => {
  const mockIdea: Idea = {
    id: '1',
    title: 'Test Idea',
    description: 'This is a test idea description',
    status: 'SUBMITTED',
    effort: 'ONE_TO_THREE_DAYS',
    tags: ['test', 'automation'],
    submitterId: 'user1',
    submitter: {
      id: 'user1',
      name: 'John Doe',
      email: 'john@example.com',
    },
    approver: null,
    assignee: null,
    submittedAt: '2024-01-15T10:00:00Z',
    approvedAt: null,
    startedAt: null,
    completedAt: null,
    rejectedAt: null,
  };

  it('renders idea title', () => {
    const wrapper = mount(IdeaCard, {
      props: {
        idea: mockIdea,
      },
    });

    expect(wrapper.text()).toContain('Test Idea');
  });

  it('displays submitter name', () => {
    const wrapper = mount(IdeaCard, {
      props: {
        idea: mockIdea,
      },
    });

    expect(wrapper.text()).toContain('John Doe');
  });

  it('shows all tags', () => {
    const wrapper = mount(IdeaCard, {
      props: {
        idea: mockIdea,
      },
    });

    expect(wrapper.text()).toContain('test');
    expect(wrapper.text()).toContain('automation');
  });

  it('emits view event when view button is clicked', async () => {
    const wrapper = mount(IdeaCard, {
      props: {
        idea: mockIdea,
      },
    });

    const button = wrapper.find('button');
    await button.trigger('click');

    expect(wrapper.emitted('view')).toBeTruthy();
    expect(wrapper.emitted('view')?.[0]).toEqual(['1']);
  });

  it('truncates long descriptions', () => {
    const longDescription = 'a'.repeat(200);
    const ideaWithLongDesc = {
      ...mockIdea,
      description: longDescription,
    };

    const wrapper = mount(IdeaCard, {
      props: {
        idea: ideaWithLongDesc,
      },
    });

    const text = wrapper.text();
    expect(text).toContain('...');
    expect(text.length).toBeLessThan(longDescription.length);
  });

  it('displays approver when present', () => {
    const approvedIdea = {
      ...mockIdea,
      approver: {
        id: 'approver1',
        name: 'Jane Smith',
        email: 'jane@example.com',
      },
    };

    const wrapper = mount(IdeaCard, {
      props: {
        idea: approvedIdea,
      },
    });

    expect(wrapper.text()).toContain('Jane Smith');
  });

  it('displays assignee when present', () => {
    const assignedIdea = {
      ...mockIdea,
      assignee: {
        id: 'assignee1',
        name: 'Bob Johnson',
        email: 'bob@example.com',
      },
    };

    const wrapper = mount(IdeaCard, {
      props: {
        idea: assignedIdea,
      },
    });

    expect(wrapper.text()).toContain('Bob Johnson');
  });
});
