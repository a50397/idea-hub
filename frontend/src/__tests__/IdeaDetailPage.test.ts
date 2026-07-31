import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import IdeaDetailPage from '../pages/IdeaDetailPage.vue';
import { useAuthStore } from '../stores/auth';
import { IdeaStatus, Effort, Role } from '../types';
import type { Idea } from '../types';
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
const mockedIdeas = vi.mocked(ideasApi);
const mockedOptions = vi.mocked(optionsApi);

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
    mockedOptions.get.mockResolvedValue({ mailEnabled: true, ssoShowLogout: false });
  });

  it('hides the toggle for a non-submitter even when mail is enabled', async () => {
    mockedOptions.get.mockResolvedValue({ mailEnabled: true, ssoShowLogout: false });
    signInAs(OTHER_ID);
    const wrapper = mountPage();
    await flushPromises();

    expect(toggle(wrapper).exists()).toBe(false);
  });

  it('hides the toggle from the submitter when mail is disabled', async () => {
    mockedOptions.get.mockResolvedValue({ mailEnabled: false, ssoShowLogout: false });
    signInAs(SUBMITTER_ID);
    const wrapper = mountPage();
    await flushPromises();

    expect(toggle(wrapper).exists()).toBe(false);
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
