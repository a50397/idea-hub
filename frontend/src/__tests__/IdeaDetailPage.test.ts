import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import IdeaDetailPage from '../pages/IdeaDetailPage.vue';
import { useAuthStore } from '../stores/auth';
import { IdeaStatus, Effort, Role, EventType } from '../types';
import type { Idea, IdeaEvent } from '../types';
import { createTestI18n, createTestVuetify } from './helpers';

// The page reads route.params.id in script; the template's $router.back() is only
// invoked on click, so a route stub is enough for these tests.
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'idea-1' } }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock('../api/ideas', () => ({
  ideasApi: {
    getOne: vi.fn(),
    setNotify: vi.fn(),
    complete: vi.fn(),
    addStep: vi.fn(),
    createJiraTask: vi.fn(),
    getJiraTarget: vi.fn(),
    markDone: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
  },
}));

// The dispatch dialog fetches the tech account's visible projects on every open.
vi.mock('../api/jiraSettings', () => ({
  jiraSettingsApi: {
    getProjects: vi.fn(),
  },
}));

// onMounted fetches runtime options (via the options store) to decide toggle
// visibility; without this mock that call would hit real axios.
vi.mock('../api/options', () => ({
  optionsApi: {
    get: vi.fn(),
  },
}));

// The auth store imports authApi at module load; stub it so nothing touches the network.
vi.mock('../api/auth', () => ({
  authApi: {
    login: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(),
    getConfig: vi.fn(),
    changePassword: vi.fn(),
  },
}));

import { ideasApi } from '../api/ideas';
import { optionsApi } from '../api/options';
import { jiraSettingsApi } from '../api/jiraSettings';
const mockedIdeas = vi.mocked(ideasApi);
const mockedOptions = vi.mocked(optionsApi);
const mockedJiraSettings = vi.mocked(jiraSettingsApi);

const SUBMITTER_ID = 'u1';
const OTHER_ID = 'u2';

function makeIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: 'idea-1',
    title: 'A submitted idea',
    description: 'Some description text',
    benefits: 'Some benefits',
    effort: Effort.LESS_THAN_ONE_DAY,
    status: IdeaStatus.SUBMITTED,
    tags: [],
    submitterId: SUBMITTER_ID,
    submitter: { id: SUBMITTER_ID, name: 'Me', email: 'me@x.com', role: Role.USER },
    notifyOnChange: false,
    submittedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mountPage() {
  return mount(IdeaDetailPage, {
    global: { plugins: [createTestVuetify(), createTestI18n('en')] },
  });
}

// Sign in as `userId`; when it equals the idea's submitterId the current user is
// the submitter (the only role allowed to see/flip the toggle).
function signInAs(userId: string) {
  const auth = useAuthStore();
  auth.user = { id: userId, name: 'Actor', email: 'actor@x.com', role: Role.USER };
}

const toggle = (wrapper: ReturnType<typeof mountPage>) =>
  wrapper.findComponent({ name: 'VSwitch' });

describe('IdeaDetailPage notify toggle', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockedIdeas.getOne.mockResolvedValue(makeIdea());
    mockedIdeas.setNotify.mockResolvedValue(makeIdea({ notifyOnChange: true }));
    mockedOptions.get.mockResolvedValue({ mailEnabled: true, webexEnabled: false, jiraEnabled: false, ssoShowLogout: false });
  });

  it('hides the toggle for a non-submitter even when mail is enabled', async () => {
    mockedOptions.get.mockResolvedValue({ mailEnabled: true, webexEnabled: false, jiraEnabled: false, ssoShowLogout: false });
    signInAs(OTHER_ID);
    const wrapper = mountPage();
    await flushPromises();

    expect(toggle(wrapper).exists()).toBe(false);
  });

  it('hides the toggle from the submitter when both channels are disabled', async () => {
    mockedOptions.get.mockResolvedValue({ mailEnabled: false, webexEnabled: false, jiraEnabled: false, ssoShowLogout: false });
    signInAs(SUBMITTER_ID);
    const wrapper = mountPage();
    await flushPromises();

    expect(toggle(wrapper).exists()).toBe(false);
  });

  // The toggle is channel-agnostic: Webex alone (mail off) reveals it for the submitter.
  it('shows the toggle to the submitter when only Webex is enabled (mail off)', async () => {
    mockedOptions.get.mockResolvedValue({ mailEnabled: false, webexEnabled: true, jiraEnabled: false, ssoShowLogout: false });
    signInAs(SUBMITTER_ID);
    const wrapper = mountPage();
    await flushPromises();

    expect(toggle(wrapper).exists()).toBe(true);
  });

  it('shows the toggle to the submitter when mail is enabled, reflecting the stored opt-in', async () => {
    mockedIdeas.getOne.mockResolvedValue(makeIdea({ notifyOnChange: true }));
    signInAs(SUBMITTER_ID);
    const wrapper = mountPage();
    await flushPromises();

    const t = toggle(wrapper);
    expect(t.exists()).toBe(true);
    expect(t.props('modelValue')).toBe(true);
  });

  it('calls setNotify with the flipped value when the submitter toggles it', async () => {
    signInAs(SUBMITTER_ID);
    const wrapper = mountPage();
    await flushPromises();

    toggle(wrapper).vm.$emit('update:modelValue', true);
    await flushPromises();

    expect(mockedIdeas.setNotify).toHaveBeenCalledTimes(1);
    expect(mockedIdeas.setNotify).toHaveBeenCalledWith('idea-1', true);
  });

  it('reverts the switch when setNotify fails', async () => {
    mockedIdeas.getOne.mockResolvedValue(makeIdea({ notifyOnChange: false }));
    mockedIdeas.setNotify.mockRejectedValueOnce({ response: { data: { error: 'boom' } } });
    signInAs(SUBMITTER_ID);
    const wrapper = mountPage();
    await flushPromises();

    toggle(wrapper).vm.$emit('update:modelValue', true);
    await flushPromises();

    // The optimistic flip is rolled back to the stored value on failure.
    expect(toggle(wrapper).props('modelValue')).toBe(false);
  });

  // Regression for the toggle race guard: overlapping setNotify calls would let the
  // last RESPONSE win locally but the last REQUEST win in the DB. A second flip while
  // the first request is still in flight must be ignored (no second API call), and
  // the switch must settle to the first request's outcome.
  it('ignores a second toggle while the first setNotify is still in flight', async () => {
    mockedIdeas.getOne.mockResolvedValue(makeIdea({ notifyOnChange: false }));
    // A controllable pending promise keeps the first setNotify "in flight" until we
    // release it, so the second toggle happens mid-request.
    let resolveFirst!: (idea: Idea) => void;
    const pending = new Promise<Idea>((resolve) => {
      resolveFirst = resolve;
    });
    mockedIdeas.setNotify.mockReturnValueOnce(pending);
    signInAs(SUBMITTER_ID);
    const wrapper = mountPage();
    await flushPromises();

    // First flip (off -> on): starts the request but leaves it unsettled.
    toggle(wrapper).vm.$emit('update:modelValue', true);
    await flushPromises();
    expect(mockedIdeas.setNotify).toHaveBeenCalledTimes(1);

    // Second flip while the first is in flight is ignored: no second API call.
    toggle(wrapper).vm.$emit('update:modelValue', false);
    await flushPromises();
    expect(mockedIdeas.setNotify).toHaveBeenCalledTimes(1);

    // Releasing the first request settles the switch to that request's outcome (on).
    resolveFirst(makeIdea({ notifyOnChange: true }));
    await flushPromises();
    expect(toggle(wrapper).props('modelValue')).toBe(true);
    expect(mockedIdeas.setNotify).toHaveBeenCalledWith('idea-1', true);
  });
});

function makeEvent(overrides: Partial<IdeaEvent> = {}): IdeaEvent {
  return {
    id: 'ev-1',
    ideaId: 'idea-1',
    type: EventType.SUBMITTED,
    byUserId: SUBMITTER_ID,
    byUser: { id: SUBMITTER_ID, name: 'Sub Mitter', email: 'sub@x.com', role: Role.USER },
    timestamp: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('IdeaDetailPage activity timeline', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockedOptions.get.mockResolvedValue({ mailEnabled: false, webexEnabled: false, jiraEnabled: false, ssoShowLogout: false });
    signInAs(OTHER_ID); // an uninvolved viewer; steps/notify gating is not under test here
  });

  const eventCases: Array<{ type: EventType; label: string }> = [
    { type: EventType.SUBMITTED, label: 'Submitted' },
    { type: EventType.APPROVED, label: 'Approved' },
    { type: EventType.REJECTED, label: 'Rejected' },
    { type: EventType.CLAIMED, label: 'Claimed' },
    { type: EventType.STARTED, label: 'Started' },
    { type: EventType.COMPLETED, label: 'Completed' },
    { type: EventType.UPDATED, label: 'Updated' },
    { type: EventType.CHANGE_REQUESTED, label: 'Change requested' },
    { type: EventType.JIRA_CREATED, label: 'Jira task created' },
    { type: EventType.JIRA_STATUS_CHANGED, label: 'Jira status changed' },
    { type: EventType.JIRA_CANCELLED, label: 'Jira task cancelled' },
  ];

  describe.each(eventCases)('event type $type', ({ type, label }) => {
    it(`renders the "${label}" label`, async () => {
      mockedIdeas.getOne.mockResolvedValue(makeIdea({ events: [makeEvent({ type })] }));
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.text()).toContain(label);
    });
  });

  it('falls back to the raw enum value for an unmapped event type (never crashes)', async () => {
    mockedIdeas.getOne.mockResolvedValue(
      makeIdea({ events: [makeEvent({ type: 'SOMETHING_FUTURE' as unknown as EventType })] })
    );
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('SOMETHING_FUTURE');
  });

  it("shows the acting user's name when byUser is present", async () => {
    mockedIdeas.getOne.mockResolvedValue(
      makeIdea({
        events: [
          makeEvent({
            type: EventType.JIRA_CREATED,
            byUser: { id: 'p1', name: 'Power Pat', email: 'pat@x.com', role: Role.POWER_USER },
          }),
        ],
      })
    );
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('Power Pat');
  });

  // The crash-fix case (nullable byUser/byUserId): a poller-written event carries no
  // human actor at all, and the timeline must render "Jira" instead of throwing on
  // `byUser.name`.
  it('shows "Jira" as the actor when byUser/byUserId are null (poller-written event)', async () => {
    mockedIdeas.getOne.mockResolvedValue(
      makeIdea({
        events: [
          makeEvent({
            type: EventType.JIRA_STATUS_CHANGED,
            byUserId: null,
            byUser: null,
            note: 'To Do → In Progress',
          }),
        ],
      })
    );
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('Jira status changed');
    expect(wrapper.text()).toContain('by Jira');
    expect(wrapper.text()).toContain('To Do → In Progress');
  });
});

describe('IdeaDetailPage Jira sidebar block', () => {
  const APPROVED_IDEA = () =>
    makeIdea({
      status: IdeaStatus.APPROVED,
      jiraSyncActive: false,
    });

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockedIdeas.createJiraTask.mockResolvedValue(
      makeIdea({
        status: IdeaStatus.APPROVED,
        jiraIssueId: '10001',
        jiraIssueKey: 'OPS-1',
        jiraStatusCategory: 'new',
        jiraSyncActive: true,
        jiraBrowseUrl: 'https://acme.atlassian.net/browse/OPS-1',
      })
    );
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  function signInAsPowerUser() {
    const auth = useAuthStore();
    auth.user = { id: 'p1', name: 'Power Pat', email: 'pat@x.com', role: Role.POWER_USER };
  }

  it('shows the create button for a POWER_USER on an APPROVED, undispatched idea when Jira is enabled', async () => {
    mockedIdeas.getOne.mockResolvedValue(APPROVED_IDEA());
    mockedOptions.get.mockResolvedValue({ mailEnabled: false, webexEnabled: false, jiraEnabled: true, ssoShowLogout: false });
    signInAsPowerUser();
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('Create Jira task');
  });

  it('hides the create button for a regular USER', async () => {
    mockedIdeas.getOne.mockResolvedValue(APPROVED_IDEA());
    mockedOptions.get.mockResolvedValue({ mailEnabled: false, webexEnabled: false, jiraEnabled: true, ssoShowLogout: false });
    signInAs(OTHER_ID);
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).not.toContain('Create Jira task');
  });

  it('hides the create button when Jira is not enabled', async () => {
    mockedIdeas.getOne.mockResolvedValue(APPROVED_IDEA());
    mockedOptions.get.mockResolvedValue({ mailEnabled: false, webexEnabled: false, jiraEnabled: false, ssoShowLogout: false });
    signInAsPowerUser();
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).not.toContain('Create Jira task');
  });

  it('hides the create button once already dispatched (jiraSyncActive) and shows the mirrored fields instead', async () => {
    mockedIdeas.getOne.mockResolvedValue(
      makeIdea({
        status: IdeaStatus.APPROVED,
        jiraIssueKey: 'OPS-7',
        jiraStatus: 'In Review',
        jiraStatusCategory: 'indeterminate',
        jiraAssignee: 'Alice Assignee',
        jiraSyncActive: true,
        jiraBrowseUrl: 'https://acme.atlassian.net/browse/OPS-7',
      })
    );
    mockedOptions.get.mockResolvedValue({ mailEnabled: false, webexEnabled: false, jiraEnabled: true, ssoShowLogout: false });
    signInAsPowerUser();
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).not.toContain('Create Jira task');
    expect(wrapper.text()).toContain('OPS-7');
    expect(wrapper.text()).toContain('In Review');
    expect(wrapper.text()).toContain('Alice Assignee');
  });

  it('renders the Jira key as a link when jiraBrowseUrl is present', async () => {
    mockedIdeas.getOne.mockResolvedValue(
      makeIdea({ status: IdeaStatus.APPROVED, jiraIssueKey: 'OPS-7', jiraSyncActive: true, jiraBrowseUrl: 'https://acme.atlassian.net/browse/OPS-7' })
    );
    mockedOptions.get.mockResolvedValue({ mailEnabled: false, webexEnabled: false, jiraEnabled: false, ssoShowLogout: false });
    signInAs(OTHER_ID);
    const wrapper = mountPage();
    await flushPromises();

    const link = wrapper.findAll('a').find((a) => a.text().trim() === 'OPS-7');
    expect(link).toBeTruthy();
    expect(link!.attributes('href')).toBe('https://acme.atlassian.net/browse/OPS-7');
  });

  it('renders the Jira key as plain text (no link) when jiraBrowseUrl is absent', async () => {
    mockedIdeas.getOne.mockResolvedValue(
      makeIdea({ status: IdeaStatus.APPROVED, jiraIssueKey: 'OPS-7', jiraSyncActive: true })
    );
    mockedOptions.get.mockResolvedValue({ mailEnabled: false, webexEnabled: false, jiraEnabled: false, ssoShowLogout: false });
    signInAs(OTHER_ID);
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('OPS-7');
    expect(wrapper.findAll('a').find((a) => a.text().trim() === 'OPS-7')).toBeUndefined();
  });

  it('labels the key a "Cancelled task" (not the live "Jira issue") after a Jira-side cancellation', async () => {
    mockedIdeas.getOne.mockResolvedValue(
      makeIdea({
        status: IdeaStatus.APPROVED,
        jiraIssueKey: 'OPS-7',
        jiraStatus: null,
        jiraSyncActive: false,
        jiraBrowseUrl: 'https://acme.atlassian.net/browse/OPS-7',
      })
    );
    mockedOptions.get.mockResolvedValue({ mailEnabled: false, webexEnabled: false, jiraEnabled: true, ssoShowLogout: false });
    signInAsPowerUser();
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('Cancelled task');
    expect(wrapper.text()).not.toContain('Jira issue'); // the live-issue label
    // Still a link — the cancelled issue usually still exists in Jira.
    const link = wrapper.findAll('a').find((a) => a.text().trim() === 'OPS-7');
    expect(link).toBeTruthy();
    expect(link!.attributes('href')).toBe('https://acme.atlassian.net/browse/OPS-7');
    // And the idea is re-dispatchable.
    expect(wrapper.text()).toContain('Create Jira task');
  });

  it('hides the raw Jira status once the idea is no longer monitored — key link stays, caption explains', async () => {
    mockedIdeas.getOne.mockResolvedValue(
      makeIdea({
        status: IdeaStatus.DONE,
        jiraIssueKey: 'OPS-7',
        jiraStatus: "Won't Do",
        jiraSyncActive: false,
        jiraBrowseUrl: 'https://acme.atlassian.net/browse/OPS-7',
      })
    );
    mockedOptions.get.mockResolvedValue({ mailEnabled: false, webexEnabled: false, jiraEnabled: true, ssoShowLogout: false });
    signInAsPowerUser();
    const wrapper = mountPage();
    await flushPromises();

    // The frozen raw status would read as live data on an unwatched idea.
    expect(wrapper.text()).not.toContain("Won't Do");
    expect(wrapper.findAll('a').find((a) => a.text().trim() === 'OPS-7')).toBeTruthy();
    expect(wrapper.text()).toContain('The Jira status is no longer synced for this idea.');
  });

  describe('mark-done override', () => {
    function optionsOff() {
      mockedOptions.get.mockResolvedValue({
        mailEnabled: false,
        webexEnabled: false,
        jiraEnabled: false,
        ssoShowLogout: false,
      });
    }

    it.each([IdeaStatus.APPROVED, IdeaStatus.IN_PROGRESS])(
      'shows the button to a power user on a %s idea',
      async (status) => {
        mockedIdeas.getOne.mockResolvedValue(makeIdea({ status }));
        optionsOff();
        signInAsPowerUser();
        const wrapper = mountPage();
        await flushPromises();

        expect(wrapper.text()).toContain('Mark as done');
      }
    );

    it('hides the button from a regular user', async () => {
      mockedIdeas.getOne.mockResolvedValue(makeIdea({ status: IdeaStatus.APPROVED }));
      optionsOff();
      signInAs(OTHER_ID);
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.text()).not.toContain('Mark as done');
    });

    it.each([IdeaStatus.DONE, IdeaStatus.REJECTED, IdeaStatus.SUBMITTED])(
      'hides the button on a %s idea (done: nothing to override; rejected: stays rejected; submitted: review first)',
      async (status) => {
        mockedIdeas.getOne.mockResolvedValue(makeIdea({ status }));
        optionsOff();
        signInAsPowerUser();
        const wrapper = mountPage();
        await flushPromises();

        expect(wrapper.text()).not.toContain('Mark as done');
      }
    );

    it('opens the dialog, requires a reason, calls the API and refetches the idea', async () => {
      mockedIdeas.getOne.mockResolvedValue(makeIdea({ status: IdeaStatus.APPROVED }));
      optionsOff();
      mockedIdeas.markDone.mockResolvedValue(makeIdea({ status: IdeaStatus.DONE }));
      signInAsPowerUser();
      const wrapper = mountPage();
      await flushPromises();

      const openBtn = wrapper.findAll('.v-btn').find((b) => b.text().trim() === 'Mark as done');
      expect(openBtn).toBeTruthy();
      await openBtn!.trigger('click');

      const dialogs = wrapper.findAllComponents({ name: 'VDialog' });
      // dialogs: [0]=grandfathered complete, [1]=mark-done
      expect(dialogs[1].props('modelValue')).toBe(true);

      const confirm = dialogs[1]
        .findAllComponents({ name: 'VBtn' })
        .find((b) => b.text().trim() === 'Mark as done');
      expect(confirm).toBeTruthy();
      // The reason is mandatory AND must be at least 15 chars: confirm stays
      // disabled while empty or too short.
      expect(confirm!.props('disabled')).toBe(true);
      await dialogs[1].findComponent({ name: 'VTextarea' }).setValue('too short');
      expect(confirm!.props('disabled')).toBe(true);

      await dialogs[1].findComponent({ name: 'VTextarea' }).setValue('Executed outside the normal flow');
      expect(confirm!.props('disabled')).toBe(false);

      await confirm!.trigger('click');
      await flushPromises();

      expect(mockedIdeas.markDone).toHaveBeenCalledTimes(1);
      expect(mockedIdeas.markDone.mock.calls[0][1]).toBe('Executed outside the normal flow');
      // Refetched so the timeline shows the new COMPLETED entry.
      expect(mockedIdeas.getOne).toHaveBeenCalledTimes(2);
    });
  });

  describe('review actions (approve/reject) on the detail page', () => {
    function optionsOff() {
      mockedOptions.get.mockResolvedValue({
        mailEnabled: false,
        webexEnabled: false,
        jiraEnabled: false,
        ssoShowLogout: false,
      });
    }

    // Dialog order in the template: [0]=complete, [1]=mark-done, [2]=approve, [3]=reject.
    const APPROVE_DIALOG = 2;
    const REJECT_DIALOG = 3;

    it('shows Approve and Reject to a power user on a SUBMITTED idea', async () => {
      mockedIdeas.getOne.mockResolvedValue(makeIdea({ status: IdeaStatus.SUBMITTED }));
      optionsOff();
      signInAsPowerUser();
      const wrapper = mountPage();
      await flushPromises();

      const labels = wrapper.findAll('.v-btn').map((b) => b.text().trim());
      expect(labels).toContain('Approve');
      expect(labels).toContain('Reject');
    });

    it('hides them from a regular user', async () => {
      mockedIdeas.getOne.mockResolvedValue(makeIdea({ status: IdeaStatus.SUBMITTED }));
      optionsOff();
      signInAs(OTHER_ID);
      const wrapper = mountPage();
      await flushPromises();

      const labels = wrapper.findAll('.v-btn').map((b) => b.text().trim());
      expect(labels).not.toContain('Approve');
      expect(labels).not.toContain('Reject');
    });

    it.each([IdeaStatus.APPROVED, IdeaStatus.REJECTED, IdeaStatus.DONE])(
      'hides them on a %s idea (review is a SUBMITTED-only transition)',
      async (status) => {
        mockedIdeas.getOne.mockResolvedValue(makeIdea({ status }));
        optionsOff();
        signInAsPowerUser();
        const wrapper = mountPage();
        await flushPromises();

        const labels = wrapper.findAll('.v-btn').map((b) => b.text().trim());
        expect(labels).not.toContain('Approve');
        expect(labels).not.toContain('Reject');
      }
    );

    it('approves from the dialog (optional note) and refetches the idea', async () => {
      mockedIdeas.getOne.mockResolvedValue(makeIdea({ status: IdeaStatus.SUBMITTED }));
      optionsOff();
      mockedIdeas.approve.mockResolvedValue(makeIdea({ status: IdeaStatus.APPROVED }));
      signInAsPowerUser();
      const wrapper = mountPage();
      await flushPromises();

      await wrapper
        .findAll('.v-btn')
        .find((b) => b.text().trim() === 'Approve')!
        .trigger('click');

      const dialogs = wrapper.findAllComponents({ name: 'VDialog' });
      expect(dialogs[APPROVE_DIALOG].props('modelValue')).toBe(true);
      await dialogs[APPROVE_DIALOG].findComponent({ name: 'VTextarea' }).setValue('Looks good');
      await dialogs[APPROVE_DIALOG]
        .findAllComponents({ name: 'VBtn' })
        .find((b) => b.text().trim() === 'Approve')!
        .trigger('click');
      await flushPromises();

      expect(mockedIdeas.approve).toHaveBeenCalledTimes(1);
      expect(mockedIdeas.approve.mock.calls[0][1]).toEqual({ note: 'Looks good' });
      // Refetched so the status chip, buttons and timeline update in place.
      expect(mockedIdeas.getOne).toHaveBeenCalledTimes(2);
    });

    it('rejects from the dialog and refetches the idea', async () => {
      mockedIdeas.getOne.mockResolvedValue(makeIdea({ status: IdeaStatus.SUBMITTED }));
      optionsOff();
      mockedIdeas.reject.mockResolvedValue(makeIdea({ status: IdeaStatus.REJECTED }));
      signInAsPowerUser();
      const wrapper = mountPage();
      await flushPromises();

      await wrapper
        .findAll('.v-btn')
        .find((b) => b.text().trim() === 'Reject')!
        .trigger('click');

      const dialogs = wrapper.findAllComponents({ name: 'VDialog' });
      expect(dialogs[REJECT_DIALOG].props('modelValue')).toBe(true);
      await dialogs[REJECT_DIALOG].findComponent({ name: 'VTextarea' }).setValue('Not feasible');
      await dialogs[REJECT_DIALOG]
        .findAllComponents({ name: 'VBtn' })
        .find((b) => b.text().trim() === 'Reject')!
        .trigger('click');
      await flushPromises();

      expect(mockedIdeas.reject).toHaveBeenCalledTimes(1);
      expect(mockedIdeas.reject.mock.calls[0][1]).toEqual({ note: 'Not feasible' });
      expect(mockedIdeas.getOne).toHaveBeenCalledTimes(2);
    });
  });

  it('shows the resolution only once the idea is DONE', async () => {
    mockedIdeas.getOne.mockResolvedValue(
      makeIdea({
        status: IdeaStatus.IN_PROGRESS,
        jiraIssueKey: 'OPS-7',
        jiraSyncActive: true,
        jiraResolution: 'Done',
      })
    );
    mockedOptions.get.mockResolvedValue({ mailEnabled: false, webexEnabled: false, jiraEnabled: false, ssoShowLogout: false });
    signInAs(OTHER_ID);
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).not.toContain('Jira resolution');
  });

  it('creates the Jira task, opens the browse URL synchronously and reloads the idea', async () => {
    // Initial load is undispatched; the reload loadIdea() triggers after a
    // successful dispatch must reflect the NEW (now-dispatched) state.
    mockedIdeas.getOne.mockResolvedValueOnce(APPROVED_IDEA());
    mockedIdeas.getOne.mockResolvedValue(
      makeIdea({
        status: IdeaStatus.APPROVED,
        jiraIssueKey: 'OPS-1',
        jiraStatusCategory: 'new',
        jiraSyncActive: true,
        jiraBrowseUrl: 'https://acme.atlassian.net/browse/OPS-1',
      })
    );
    mockedOptions.get.mockResolvedValue({ mailEnabled: false, webexEnabled: false, jiraEnabled: true, ssoShowLogout: false });
    signInAsPowerUser();
    const wrapper = mountPage();
    await flushPromises();

    mockedJiraSettings.getProjects.mockResolvedValue({ projects: [] });
    mockedIdeas.getJiraTarget.mockResolvedValue({ projectKey: 'OPS' });
    const btn = wrapper.findAll('.v-btn').find((b) => b.text().trim() === 'Create Jira task');
    await btn!.trigger('click');
    await flushPromises(); // the /jira-target preselection resolves
    // Confirm in the dispatch dialog (dialog order: complete, mark-done, approve,
    // reject, dispatch) — the preselected resolved project travels.
    const dispatchDlg = wrapper.findAllComponents({ name: 'VDialog' })[4];
    await dispatchDlg
      .findAllComponents({ name: 'VBtn' })
      .find((b) => b.text().trim() === 'Create Jira task')!
      .trigger('click');
    await flushPromises();

    expect(mockedIdeas.createJiraTask).toHaveBeenCalledWith('idea-1', 'OPS');
    expect(window.open).toHaveBeenCalledWith('https://acme.atlassian.net/browse/OPS-1', '_blank', 'noopener');
    expect(wrapper.text()).toContain('OPS-1');
    expect(wrapper.text()).not.toContain('Create Jira task');
    // getOne is called once on initial load and again by the post-dispatch reload.
    expect(mockedIdeas.getOne).toHaveBeenCalledTimes(2);
  });

  it('handles a missing jiraBrowseUrl gracefully: no popup, but the success message still shows', async () => {
    mockedIdeas.getOne.mockResolvedValueOnce(APPROVED_IDEA());
    mockedIdeas.getOne.mockResolvedValue(
      makeIdea({ status: IdeaStatus.APPROVED, jiraIssueKey: 'OPS-2', jiraSyncActive: true })
    );
    mockedIdeas.createJiraTask.mockResolvedValue(
      makeIdea({ status: IdeaStatus.APPROVED, jiraIssueKey: 'OPS-2', jiraSyncActive: true })
    );
    mockedOptions.get.mockResolvedValue({ mailEnabled: false, webexEnabled: false, jiraEnabled: true, ssoShowLogout: false });
    signInAsPowerUser();
    const wrapper = mountPage();
    await flushPromises();

    mockedJiraSettings.getProjects.mockResolvedValue({ projects: [] });
    mockedIdeas.getJiraTarget.mockResolvedValue({ projectKey: 'OPS' });
    const btn = wrapper.findAll('.v-btn').find((b) => b.text().trim() === 'Create Jira task');
    await btn!.trigger('click');
    await flushPromises(); // preselection
    const dispatchDlg = wrapper.findAllComponents({ name: 'VDialog' })[4];
    await dispatchDlg
      .findAllComponents({ name: 'VBtn' })
      .find((b) => b.text().trim() === 'Create Jira task')!
      .trigger('click');
    await flushPromises();

    expect(window.open).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('OPS-2');
    const snackbar = wrapper.findComponent({ name: 'VSnackbar' });
    expect(snackbar.props('modelValue')).toBe(true);
  });

  it('surfaces a 502 dispatch failure as the LOCALIZED reason-catalog message, without opening a popup', async () => {
    mockedIdeas.getOne.mockResolvedValue(APPROVED_IDEA());
    mockedIdeas.createJiraTask.mockRejectedValueOnce({
      response: { status: 502, data: { error: 'Failed to create the Jira issue', reason: 'invalid_credentials' } },
    });
    mockedOptions.get.mockResolvedValue({ mailEnabled: false, webexEnabled: false, jiraEnabled: true, ssoShowLogout: false });
    signInAsPowerUser();
    const wrapper = mountPage();
    await flushPromises();

    mockedJiraSettings.getProjects.mockResolvedValue({ projects: [] });
    mockedIdeas.getJiraTarget.mockResolvedValue({ projectKey: 'OPS' });
    const btn = wrapper.findAll('.v-btn').find((b) => b.text().trim() === 'Create Jira task');
    await btn!.trigger('click');
    await flushPromises(); // preselection
    const dispatchDlg = wrapper.findAllComponents({ name: 'VDialog' })[4];
    await dispatchDlg
      .findAllComponents({ name: 'VBtn' })
      .find((b) => b.text().trim() === 'Create Jira task')!
      .trigger('click');
    await flushPromises();

    expect(window.open).not.toHaveBeenCalled();
    const snackbar = wrapper.findComponent({ name: 'VSnackbar' });
    expect(snackbar.props('color')).toBe('error');
    // The raw backend string is never shown; the closed reason maps through the
    // settings testReason catalog (deep-review fix A1).
    expect(document.body.textContent).toContain('Invalid credentials — check the account email and API token.');
    expect(document.body.textContent).not.toContain('Failed to create the Jira issue');
  });
});
