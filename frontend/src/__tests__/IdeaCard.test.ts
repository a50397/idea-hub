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

  it('labels the reviewer "Rejected by" on a REJECTED idea (the reject endpoint writes the same approver field)', () => {
    const wrapper = mountCard(
      makeIdea({
        status: IdeaStatus.REJECTED,
        approver: { id: 'a1', name: 'Bob Approver', email: 'bob@x.com', role: 'POWER_USER' as any },
      })
    );
    expect(wrapper.text()).toContain('Rejected by Bob Approver');
    expect(wrapper.text()).not.toContain('Approved by');
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

  describe('Jira chip', () => {
    /** Chip texts only — wrapper.text() would also match the "Submitted By …" caption. */
    function chipTexts(wrapper: ReturnType<typeof mountCard>): string[] {
      return wrapper.findAllComponents({ name: 'VChip' }).map((c) => c.text().trim());
    }

    it('renders no Jira chip when the idea was never dispatched', () => {
      const wrapper = mountCard(makeIdea({ tags: [] }));
      expect(wrapper.text()).not.toContain('OPS-1');
      // Only the status + effort chips (no department, no tags).
      expect(wrapper.findAllComponents({ name: 'VChip' })).toHaveLength(2);
    });

    it('renders a separate key chip + status chip, replacing the canonical status chip, once the raw status is known', () => {
      const wrapper = mountCard(
        makeIdea({
          status: IdeaStatus.IN_PROGRESS,
          jiraIssueKey: 'OPS-1',
          jiraSyncActive: true,
          jiraStatus: 'In Review',
          jiraStatusCategory: 'indeterminate',
        })
      );
      const chips = wrapper.findAllComponents({ name: 'VChip' });
      expect(chips[0].text()).toBe('OPS-1'); // the link chip
      expect(chips[1].text()).toBe('In Review'); // the (non-link) status chip
      expect(chipTexts(wrapper)).not.toContain('In Progress'); // canonical chip replaced
    });

    it('shows the key chip next to the still-canonical status right after dispatch (first poll pending)', () => {
      const wrapper = mountCard(
        makeIdea({
          status: IdeaStatus.APPROVED,
          jiraIssueKey: 'OPS-1',
          jiraSyncActive: true,
          jiraStatus: null,
          jiraStatusCategory: 'new',
        })
      );
      const chips = wrapper.findAllComponents({ name: 'VChip' });
      expect(chips[0].text()).toBe('OPS-1');
      // No raw status yet, so the canonical chip stays (it is still accurate).
      expect(chips[1].text()).toBe('Approved');
    });

    it('suppresses the chip when a Jira-side cancellation left a stale key behind (sync off, raw status nulled)', () => {
      const wrapper = mountCard(
        makeIdea({
          status: IdeaStatus.APPROVED,
          jiraIssueKey: 'OPS-1',
          jiraSyncActive: false,
          jiraStatus: null,
          jiraStatusCategory: null,
        })
      );
      expect(wrapper.text()).not.toContain('OPS-1');
      expect(chipTexts(wrapper)).toContain('Approved'); // back to the canonical chip
    });

    it('hides the raw status once the idea is no longer monitored — the canonical chip returns, the key link stays', () => {
      const wrapper = mountCard(
        makeIdea({
          status: IdeaStatus.DONE,
          jiraIssueKey: 'OPS-1',
          jiraSyncActive: false,
          jiraStatus: 'Resolved',
          jiraStatusCategory: 'done',
        })
      );
      const chips = wrapper.findAllComponents({ name: 'VChip' });
      expect(chips[0].text()).toBe('OPS-1'); // history + link
      expect(chips[1].text()).toBe('Done'); // canonical — a frozen raw status would read as live data
      expect(chipTexts(wrapper)).not.toContain('Resolved');
    });

    it('links the KEY chip (only) to the server-built browse URL (new tab, noopener)', () => {
      const wrapper = mountCard(
        makeIdea({
          jiraIssueKey: 'OPS-1',
          jiraSyncActive: true,
          jiraStatus: 'In Review',
          jiraStatusCategory: 'indeterminate',
          jiraBrowseUrl: 'https://acme.atlassian.net/browse/OPS-1',
        })
      );
      const chips = wrapper.findAllComponents({ name: 'VChip' });
      expect(chips[0].attributes('href')).toBe('https://acme.atlassian.net/browse/OPS-1');
      expect(chips[0].attributes('target')).toBe('_blank');
      expect(chips[0].attributes('rel')).toBe('noopener');
      // The status chip must NOT navigate — clicking a "status" that opens Jira
      // reads as a misclick.
      expect(chips[1].attributes('href')).toBeUndefined();
    });

    it('renders a plain (non-link) key chip when the server omitted the browse URL', () => {
      const wrapper = mountCard(makeIdea({ jiraIssueKey: 'OPS-1', jiraSyncActive: true }));
      const chip = wrapper.findAllComponents({ name: 'VChip' })[0];
      expect(chip.text()).toBe('OPS-1');
      expect(chip.attributes('href')).toBeUndefined();
    });

    // The tooltip TEXT (active "synced periodically" vs final "no longer updated")
    // renders only on hover, so these pin the placement: exactly one explanation
    // tooltip per card, and none once no Jira chip is shown.
    it.each([
      ['sync on, no raw status yet (tooltip on the key chip)', { jiraSyncActive: true, jiraStatus: null }, 1],
      ['sync on, raw status known (tooltip on the status chip)', { jiraSyncActive: true, jiraStatus: 'In Review' }, 1],
      ['unmonitored, raw status retained (tooltip on the key chip)', { jiraSyncActive: false, jiraStatus: 'Resolved' }, 1],
      ['stale key after a cancel (no chip, no tooltip)', { jiraSyncActive: false, jiraStatus: null }, 0],
    ])('explanation tooltip: %s', (_label, jiraFields, count) => {
      const wrapper = mountCard(makeIdea({ jiraIssueKey: 'OPS-1', ...jiraFields }));
      expect(wrapper.findAllComponents({ name: 'VTooltip' })).toHaveLength(count);
    });

    const categoryCases: Array<{ category: 'new' | 'indeterminate' | 'done'; color: string }> = [
      { category: 'new', color: 'info' },
      { category: 'indeterminate', color: 'warning' },
      { category: 'done', color: 'success' },
    ];

    describe.each(categoryCases)('category $category', ({ category, color }) => {
      it(`colors the status chip ${color}`, () => {
        const wrapper = mountCard(
          makeIdea({ jiraIssueKey: 'OPS-1', jiraSyncActive: true, jiraStatus: 'Some Status', jiraStatusCategory: category })
        );
        // chips[0] is the key chip; the status chip carries the category color.
        const chip = wrapper.findAllComponents({ name: 'VChip' })[1];
        expect(chip.props('color')).toBe(color);
      });
    });

    it('falls back to a neutral color when the status is known but the category is not (yet)', () => {
      const wrapper = mountCard(
        makeIdea({ jiraIssueKey: 'OPS-1', jiraSyncActive: true, jiraStatus: 'To Do', jiraStatusCategory: null })
      );
      const chip = wrapper.findAllComponents({ name: 'VChip' })[1];
      expect(chip.props('color')).toBe('default');
    });

    it('caps an absurdly long remote status name behind an ellipsis (deep-review fix A2)', () => {
      const wrapper = mountCard(
        makeIdea({ jiraIssueKey: 'OPS-1', jiraSyncActive: true, jiraStatus: 'X'.repeat(255), jiraStatusCategory: 'indeterminate' })
      );
      const chips = wrapper.findAllComponents({ name: 'VChip' });
      // The status chip carries the max-width class and an inner truncating span,
      // and the effort chip next to it still renders.
      expect(chips[1].classes()).toContain('jira-status-chip');
      expect(chips[1].find('span.text-truncate').exists()).toBe(true);
      expect(chips[2].text()).toBe('1-3 days');
    });
  });
});
