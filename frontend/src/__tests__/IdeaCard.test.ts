import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import IdeaCard from '../components/IdeaCard.vue';
import { IdeaStatus, Effort, statusColors } from '../types';
import type { Idea } from '../types';
import { createTestI18n, createTestVuetify } from './helpers';

function makeIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: 'idea-1',
    title: 'Improve onboarding flow',
    description: 'A'.repeat(200), // long enough to exercise truncate()
    benefits: 'Faster ramp-up',
    effort: Effort.ONE_TO_THREE_DAYS,
    status: IdeaStatus.SUBMITTED,
    tags: ['ux', 'onboarding'],
    submitterId: 'u1',
    submitter: { id: 'u1', name: 'Alice Submitter', email: 'alice@x.com', role: 'USER' as any },
    submittedAt: '2026-01-15T10:00:00.000Z',
    createdAt: '2026-01-15T10:00:00.000Z',
    updatedAt: '2026-01-15T10:00:00.000Z',
    ...overrides,
  };
}

function mountCard(idea: Idea, locale = 'en') {
  return mount(IdeaCard, {
    props: { idea },
    global: { plugins: [createTestVuetify(), createTestI18n(locale)] },
  });
}

describe('IdeaCard', () => {
  it('renders the idea title and submitter name', () => {
    const wrapper = mountCard(makeIdea());
    expect(wrapper.text()).toContain('Improve onboarding flow');
    expect(wrapper.text()).toContain('Alice Submitter');
  });

  it('renders all tags as chips', () => {
    const wrapper = mountCard(makeIdea({ tags: ['ux', 'onboarding', 'priority'] }));
    expect(wrapper.text()).toContain('ux');
    expect(wrapper.text()).toContain('onboarding');
    expect(wrapper.text()).toContain('priority');
  });

  it('truncates long descriptions to 150 chars with an ellipsis', () => {
    const wrapper = mountCard(makeIdea({ description: 'B'.repeat(300) }));
    expect(wrapper.text()).toContain('B'.repeat(150) + '...');
    expect(wrapper.text()).not.toContain('B'.repeat(151));
  });

  it('does not truncate short descriptions', () => {
    const wrapper = mountCard(makeIdea({ description: 'Short and sweet' }));
    expect(wrapper.text()).toContain('Short and sweet');
    expect(wrapper.text()).not.toContain('Short and sweet...');
  });

  it('emits "view" with the idea id when View Details is clicked', async () => {
    const wrapper = mountCard(makeIdea({ id: 'idea-42' }));
    const btn = wrapper.findAll('.v-btn').find((b) => b.text().trim() === 'View Details');
    expect(btn).toBeTruthy();
    await btn!.trigger('click');
    expect(wrapper.emitted('view')).toBeTruthy();
    expect(wrapper.emitted('view')![0]).toEqual(['idea-42']);
  });

  it('shows approver and assignee when present', () => {
    const wrapper = mountCard(
      makeIdea({
        approver: { id: 'a1', name: 'Bob Approver', email: 'bob@x.com', role: 'POWER_USER' as any },
        assignee: { id: 'g1', name: 'Carol Assignee', email: 'carol@x.com', role: 'USER' as any },
      })
    );
    expect(wrapper.text()).toContain('Approved by Bob Approver');
    expect(wrapper.text()).toContain('Assigned to Carol Assignee');
  });

  const statusCases: Array<{ status: IdeaStatus; label: string }> = [
    { status: IdeaStatus.SUBMITTED, label: 'Submitted' },
    { status: IdeaStatus.APPROVED, label: 'Approved' },
    { status: IdeaStatus.IN_PROGRESS, label: 'In Progress' },
    { status: IdeaStatus.DONE, label: 'Done' },
    { status: IdeaStatus.REJECTED, label: 'Rejected' },
  ];

  describe.each(statusCases)('status chip for %s', ({ status, label }) => {
    it(`renders the "${label}" label and the ${statusColors[status]} color`, () => {
      const wrapper = mountCard(makeIdea({ status }));
      const chip = wrapper.findAllComponents({ name: 'VChip' })[0];
      expect(chip.props('color')).toBe(statusColors[status]);
      expect(chip.text()).toBe(label);
    });
  });

  const effortCases: Array<{ effort: Effort; label: string }> = [
    { effort: Effort.LESS_THAN_ONE_DAY, label: '< 1 day' },
    { effort: Effort.ONE_TO_THREE_DAYS, label: '1-3 days' },
    { effort: Effort.MORE_THAN_THREE_DAYS, label: '> 3 days' },
  ];

  describe.each(effortCases)('effort chip for %s', ({ effort, label }) => {
    it(`renders the "${label}" label`, () => {
      const wrapper = mountCard(makeIdea({ effort }));
      // The effort chip is the second VChip (after the status chip).
      const chip = wrapper.findAllComponents({ name: 'VChip' })[1];
      expect(chip.text()).toBe(label);
    });
  });

  it('renders a department chip with the name when the idea has a department', () => {
    const wrapper = mountCard(makeIdea({ department: { id: 'd1', name: 'Marketing' }, tags: [] }));
    const chipTexts = wrapper.findAllComponents({ name: 'VChip' }).map((c) => c.text().trim());
    expect(chipTexts).toContain('Marketing');
  });

  it('omits the department chip when the idea has no department', () => {
    const wrapper = mountCard(makeIdea({ department: null, tags: [] }));
    // Only the status and effort chips remain (no department, no tags).
    expect(wrapper.findAllComponents({ name: 'VChip' })).toHaveLength(2);
    expect(wrapper.text()).not.toContain('Marketing');
  });

  it('translates the status label when locale is SK', () => {
    const wrapper = mountCard(makeIdea({ status: IdeaStatus.SUBMITTED }), 'sk');
    const chip = wrapper.findAllComponents({ name: 'VChip' })[0];
    expect(chip.text()).toBe('Odoslané');
  });
});
