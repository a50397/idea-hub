import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import JiraSettingsPage from '../pages/JiraSettingsPage.vue';
import type { JiraSettings } from '../types';
import { createTestI18n, createTestVuetify } from './helpers';

vi.mock('../api/jiraSettings', () => ({
  jiraSettingsApi: {
    get: vi.fn(),
    update: vi.fn(),
    test: vi.fn(),
    getProjects: vi.fn(),
  },
}));

import { jiraSettingsApi } from '../api/jiraSettings';
const mockedApi = vi.mocked(jiraSettingsApi);

function masked(overrides: Partial<JiraSettings> = {}): JiraSettings {
  return {
    enabled: false,
    baseUrl: '',
    email: '',
    defaultProjectKey: '',
    issueTypeName: 'Task',
    pollIntervalMinutes: 5,
    cancelResolutions: "Won't Do,Cancelled,Duplicate",
    hasToken: false,
    ...overrides,
  };
}

function mountPage() {
  return mount(JiraSettingsPage, {
    global: { plugins: [createTestVuetify(), createTestI18n('en')] },
  });
}

// Target a VTextField by (a substring of) its label, then set its value.
function fieldByLabel(wrapper: VueWrapper, label: string) {
  return wrapper
    .findAllComponents({ name: 'VTextField' })
    .find((f) => String(f.props('label') ?? '').includes(label));
}
function setField(wrapper: VueWrapper, label: string, value: string) {
  fieldByLabel(wrapper, label)!.vm.$emit('update:modelValue', value);
}
function button(wrapper: VueWrapper, label: string) {
  return wrapper.findAllComponents({ name: 'VBtn' }).find((b) => b.text().trim() === label);
}
// The clear-saved-token checkbox (only rendered when a token is stored).
function clearTokenCheckbox(wrapper: VueWrapper) {
  return wrapper.findComponent({ name: 'VCheckbox' });
}
function projectCombobox(wrapper: VueWrapper) {
  return wrapper.findComponent({ name: 'VCombobox' });
}

describe('JiraSettingsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockedApi.get.mockResolvedValue(masked());
    mockedApi.update.mockResolvedValue(masked());
    mockedApi.test.mockResolvedValue({ ok: true });
    mockedApi.getProjects.mockResolvedValue({ projects: [{ key: 'OPS', name: 'Operations' }] });
  });

  it('loads the masked settings on mount and shows the "no token saved" hint', async () => {
    mockedApi.get.mockResolvedValue(masked({ enabled: true, hasToken: false, baseUrl: 'https://acme.atlassian.net' }));
    const wrapper = mountPage();
    await flushPromises();

    expect(mockedApi.get).toHaveBeenCalledTimes(1);
    expect(fieldByLabel(wrapper, 'API token')!.props('modelValue')).toBe('');
    expect(wrapper.text()).toContain('No token saved');
    expect(fieldByLabel(wrapper, 'Jira base URL')!.props('modelValue')).toBe('https://acme.atlassian.net');
  });

  it('shows the "saved — leave blank to keep" hint when a token is already stored', async () => {
    mockedApi.get.mockResolvedValue(masked({ hasToken: true }));
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('A token is saved');
    expect(fieldByLabel(wrapper, 'API token')!.props('modelValue')).toBe('');
  });

  it('KEEPS the stored token (omits the apiToken key) when the field is left blank', async () => {
    mockedApi.get.mockResolvedValue(
      masked({ enabled: true, hasToken: true, baseUrl: 'https://acme.atlassian.net', email: 'tech@corp.example' })
    );
    const wrapper = mountPage();
    await flushPromises();

    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).toHaveBeenCalledTimes(1);
    const payload = mockedApi.update.mock.calls[0][0];
    expect(payload).not.toHaveProperty('apiToken');
    expect(payload).toMatchObject({ enabled: true });
  });

  it('SETS the token (trimmed) when the admin types one', async () => {
    mockedApi.get.mockResolvedValue(
      masked({ enabled: true, hasToken: false, baseUrl: 'https://acme.atlassian.net', email: 'tech@corp.example' })
    );
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'API token', '  brand-new-token  ');
    await flushPromises();

    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).toHaveBeenCalledTimes(1);
    expect(mockedApi.update.mock.calls[0][0]).toMatchObject({ apiToken: 'brand-new-token' });
  });

  it('refetches the projects list after a successful save (new credentials may see other projects)', async () => {
    mockedApi.get.mockResolvedValue(
      masked({ enabled: true, hasToken: true, baseUrl: 'https://acme.atlassian.net', email: 'tech@corp.example' })
    );
    const wrapper = mountPage();
    await flushPromises();
    expect(mockedApi.getProjects).toHaveBeenCalledTimes(1); // on mount

    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).toHaveBeenCalledTimes(1);
    // The picker must not keep offering the OLD account's projects (the list was
    // previously loaded on mount only — the user-reported staleness).
    expect(mockedApi.getProjects).toHaveBeenCalledTimes(2);
  });

  it('WIPES the token (sends an empty string) when the clear-token box is checked, even over leftover typed text', async () => {
    mockedApi.get.mockResolvedValue(
      masked({ enabled: false, hasToken: true, baseUrl: 'https://acme.atlassian.net', email: 'tech@corp.example' })
    );
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'API token', 'typed-then-abandoned');
    await flushPromises();
    clearTokenCheckbox(wrapper).vm.$emit('update:modelValue', true);
    await flushPromises();

    // The watcher clears the model so the field never disagrees with the wipe intent.
    expect(fieldByLabel(wrapper, 'API token')!.props('modelValue')).toBe('');

    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).toHaveBeenCalledTimes(1);
    const payload = mockedApi.update.mock.calls[0][0];
    expect(payload).toHaveProperty('apiToken', '');
  });

  it('blocks the save with an inline error when enabled but no token is stored or typed', async () => {
    mockedApi.get.mockResolvedValue(
      masked({ enabled: true, hasToken: false, baseUrl: 'https://acme.atlassian.net', email: 'tech@corp.example' })
    );
    const wrapper = mountPage();
    await flushPromises();

    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('An API token is required when Jira is enabled');
  });

  describe('F2 credential-binding hint (base URL / email change)', () => {
    it('switches the token hint to explain the re-entry rule as soon as the base URL is edited', async () => {
      mockedApi.get.mockResolvedValue(
        masked({ hasToken: true, baseUrl: 'https://acme.atlassian.net', email: 'tech@corp.example' })
      );
      const wrapper = mountPage();
      await flushPromises();
      expect(wrapper.text()).toContain('A token is saved');

      setField(wrapper, 'Jira base URL', 'https://other.atlassian.net');
      await flushPromises();

      expect(wrapper.text()).toContain('requires re-entering the API token');
    });

    it('blocks the save with an error when the base URL changes but the stored token is neither re-entered nor cleared', async () => {
      mockedApi.get.mockResolvedValue(
        masked({ enabled: true, hasToken: true, baseUrl: 'https://acme.atlassian.net', email: 'tech@corp.example' })
      );
      const wrapper = mountPage();
      await flushPromises();

      setField(wrapper, 'Jira base URL', 'https://other.atlassian.net');
      await flushPromises();

      await button(wrapper, 'Save settings')!.trigger('click');
      await flushPromises();

      expect(mockedApi.update).not.toHaveBeenCalled();
      // The error is inline on the token field (not teleported), unlike a dialog/
      // snackbar — assert on the wrapper's own tree, not document.body.
      expect(wrapper.text()).toContain('requires re-entering the API token');
    });

    it('ALLOWS a base-URL change that also SETS a fresh token', async () => {
      mockedApi.get.mockResolvedValue(
        masked({ enabled: true, hasToken: true, baseUrl: 'https://acme.atlassian.net', email: 'tech@corp.example' })
      );
      const wrapper = mountPage();
      await flushPromises();

      setField(wrapper, 'Jira base URL', 'https://other.atlassian.net');
      setField(wrapper, 'API token', 'fresh-token');
      await flushPromises();

      await button(wrapper, 'Save settings')!.trigger('click');
      await flushPromises();

      expect(mockedApi.update).toHaveBeenCalledTimes(1);
      expect(mockedApi.update.mock.calls[0][0]).toMatchObject({
        baseUrl: 'https://other.atlassian.net',
        apiToken: 'fresh-token',
      });
    });

    it('does NOT block a save that changes neither the base URL nor the email', async () => {
      mockedApi.get.mockResolvedValue(
        masked({ enabled: true, hasToken: true, baseUrl: 'https://acme.atlassian.net', email: 'tech@corp.example' })
      );
      const wrapper = mountPage();
      await flushPromises();

      await button(wrapper, 'Save settings')!.trigger('click');
      await flushPromises();

      expect(mockedApi.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('token hint mount-sequencing (regression)', () => {
    // Regression for a mount race: the store's `settings` used to arrive (via
    // `jiraStore.fetch()`) a full microtask tick before this page's `form` was
    // synced via `applySettings()`. For that one render, `identityChanged` read
    // `form.baseUrl`/`form.email` (still blank) against the just-fetched `settings`
    // and read true, so `tokenHint` briefly computed the F2 re-entry warning before
    // settling on the correct "token is saved" hint — even though nothing was ever
    // edited. Vuetify's real hint transition left orphaned message nodes behind
    // when that happened (seen in a live e2e accessibility snapshot); happy-dom
    // stubs `<transition-group>`, so that DOM artifact isn't reproducible here —
    // this instead asserts the underlying invariant that made it possible: at every
    // point during mount, `tokenHint` must already be its final, correct value and
    // must never show the re-entry warning unless the admin actually edited
    // baseUrl/email. A single `flushPromises()` would drain the whole mount
    // sequence in one go and only ever observe the (already-correct) end state, so
    // this steps through the microtask queue tick-by-tick instead.
    it('never flashes the re-entry warning while settling on the stored-token hint', async () => {
      let resolveGet!: (v: JiraSettings) => void;
      mockedApi.get.mockReturnValue(
        new Promise((resolve) => {
          resolveGet = resolve;
        })
      );
      const wrapper = mountPage();
      const hintTexts = () =>
        fieldByLabel(wrapper, 'API token')!
          .findAll('.v-messages__message')
          .map((m) => m.text());

      resolveGet(
        masked({ hasToken: true, baseUrl: 'https://acme.atlassian.net', email: 'tech@corp.example' })
      );
      for (let i = 0; i < 8; i++) {
        await Promise.resolve();
        const texts = hintTexts();
        expect(texts).toHaveLength(1);
        expect(texts).not.toContain(
          'Changing the base URL or account email requires re-entering the API token (or clearing it).'
        );
      }
      await flushPromises();
      expect(hintTexts()).toEqual(['A token is saved — leave blank to keep it']);
    });

    it('shows the real edit warning immediately, without an extra render tick', async () => {
      mockedApi.get.mockResolvedValue(
        masked({ hasToken: true, baseUrl: 'https://acme.atlassian.net', email: 'tech@corp.example' })
      );
      const wrapper = mountPage();
      await flushPromises();

      setField(wrapper, 'Jira base URL', 'https://other.atlassian.net');
      await flushPromises();

      expect(
        fieldByLabel(wrapper, 'API token')!
          .findAll('.v-messages__message')
          .map((m) => m.text())
      ).toEqual(['Changing the base URL or account email requires re-entering the API token (or clearing it).']);
    });
  });

  describe('other field validation', () => {
    it('requires a base URL when enabled', async () => {
      mockedApi.get.mockResolvedValue(masked({ enabled: true, email: 'tech@corp.example', hasToken: true }));
      const wrapper = mountPage();
      await flushPromises();

      await button(wrapper, 'Save settings')!.trigger('click');
      await flushPromises();

      expect(mockedApi.update).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('A base URL is required when Jira is enabled');
    });

    it('rejects a non-https base URL inline', async () => {
      const wrapper = mountPage();
      await flushPromises();

      setField(wrapper, 'Jira base URL', 'http://acme.atlassian.net');
      await flushPromises();
      await button(wrapper, 'Save settings')!.trigger('click');
      await flushPromises();

      expect(mockedApi.update).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('Base URL must start with https://');
    });

    it('requires the issue type unconditionally (even when disabled)', async () => {
      const wrapper = mountPage();
      await flushPromises();

      setField(wrapper, 'Issue type', '');
      await flushPromises();
      await button(wrapper, 'Save settings')!.trigger('click');
      await flushPromises();

      expect(mockedApi.update).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('An issue type is required');
    });

    it('rejects an out-of-range poll interval', async () => {
      const wrapper = mountPage();
      await flushPromises();

      const field = wrapper
        .findAllComponents({ name: 'VTextField' })
        .find((f) => String(f.props('label') ?? '').includes('Poll interval'));
      field!.vm.$emit('update:modelValue', 1441);
      await flushPromises();

      await button(wrapper, 'Save settings')!.trigger('click');
      await flushPromises();

      expect(mockedApi.update).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('Poll interval must be a whole number between 1 and 1440');
    });
  });

  describe('default project key picker', () => {
    it('fetches the project listing on mount and shows it as combobox items', async () => {
      mockedApi.getProjects.mockResolvedValue({
        projects: [{ key: 'OPS', name: 'Operations' }, { key: 'MKT', name: 'Marketing' }],
      });
      const wrapper = mountPage();
      await flushPromises();

      expect(mockedApi.getProjects).toHaveBeenCalledTimes(1);
      expect(projectCombobox(wrapper).props('items')).toEqual([
        { title: 'OPS — Operations', value: 'OPS' },
        { title: 'MKT — Marketing', value: 'MKT' },
      ]);
    });

    it('still allows manual key entry and shows a hint when projects cannot be loaded', async () => {
      mockedApi.getProjects.mockResolvedValue({ projects: [], reason: 'config_error' });
      const wrapper = mountPage();
      await flushPromises();

      expect(projectCombobox(wrapper).props('items')).toEqual([]);
      expect(projectCombobox(wrapper).props('hint')).toBe(
        "Couldn't load Jira projects — you can still enter a project key manually"
      );

      projectCombobox(wrapper).vm.$emit('update:modelValue', 'manual1');
      await flushPromises();

      await button(wrapper, 'Save settings')!.trigger('click');
      await flushPromises();

      expect(mockedApi.update).toHaveBeenCalledTimes(1);
      expect(mockedApi.update.mock.calls[0][0]).toMatchObject({ defaultProjectKey: 'MANUAL1' });
    });

    it('saves a picked project key uppercased', async () => {
      const wrapper = mountPage();
      await flushPromises();

      projectCombobox(wrapper).vm.$emit('update:modelValue', { value: 'ops' });
      await flushPromises();

      await button(wrapper, 'Save settings')!.trigger('click');
      await flushPromises();

      expect(mockedApi.update.mock.calls[0][0]).toMatchObject({ defaultProjectKey: 'OPS' });
    });
  });

  it('CLEARS the token and refreshes the hint after a successful save', async () => {
    mockedApi.get.mockResolvedValue(masked({ enabled: true, hasToken: false, baseUrl: 'https://acme.atlassian.net', email: 'tech@corp.example' }));
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('No token saved');

    setField(wrapper, 'API token', 'brand-new-token');
    await flushPromises();

    mockedApi.update.mockResolvedValueOnce(masked({ enabled: true, hasToken: true, baseUrl: 'https://acme.atlassian.net', email: 'tech@corp.example' }));
    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).toHaveBeenCalledTimes(1);
    expect(fieldByLabel(wrapper, 'API token')!.props('modelValue')).toBe('');
    expect(wrapper.text()).toContain('A token is saved');
  });

  it('surfaces a save failure with the server error message', async () => {
    mockedApi.get.mockResolvedValue(masked({ enabled: true, hasToken: true, baseUrl: 'https://acme.atlassian.net', email: 'tech@corp.example' }));
    mockedApi.update.mockRejectedValueOnce({ response: { data: { error: 'Jira save rejected' } } });
    const wrapper = mountPage();
    await flushPromises();

    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    const snackbar = wrapper.findComponent({ name: 'VSnackbar' });
    expect(snackbar.props('color')).toBe('error');
    expect(document.body.textContent).toContain('Jira save rejected');
  });

  describe('connection test', () => {
    it('sends a test and surfaces a success result', async () => {
      mockedApi.test.mockResolvedValueOnce({ ok: true });
      const wrapper = mountPage();
      await flushPromises();

      await button(wrapper, 'Test connection')!.trigger('click');
      await flushPromises();

      expect(mockedApi.test).toHaveBeenCalledTimes(1);
      expect(wrapper.text()).toContain('Connection succeeded.');
      expect(wrapper.findComponent({ name: 'VAlert' }).props('type')).toBe('success');
    });

    it('maps a failure reason to its own message (te()-guarded)', async () => {
      mockedApi.test.mockResolvedValueOnce({ ok: false, reason: 'invalid_credentials' });
      const wrapper = mountPage();
      await flushPromises();

      await button(wrapper, 'Test connection')!.trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('Invalid credentials');
      expect(wrapper.findComponent({ name: 'VAlert' }).props('type')).toBe('error');
    });

    it('maps the config_error reason to its own message', async () => {
      mockedApi.test.mockResolvedValueOnce({ ok: false, reason: 'config_error' });
      const wrapper = mountPage();
      await flushPromises();

      await button(wrapper, 'Test connection')!.trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('Jira is disabled or not configured');
    });

    it('surfaces a request-level failure (store returns null) as an error', async () => {
      mockedApi.test.mockRejectedValueOnce({ response: { data: { error: 'Server exploded' } } });
      const wrapper = mountPage();
      await flushPromises();

      await button(wrapper, 'Test connection')!.trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('Server exploded');
      expect(wrapper.findComponent({ name: 'VAlert' }).props('type')).toBe('error');
    });

    it('clears the stale test-result banner when settings are saved', async () => {
      mockedApi.get.mockResolvedValue(masked({ enabled: true, hasToken: true, baseUrl: 'https://acme.atlassian.net', email: 'tech@corp.example' }));
      mockedApi.test.mockResolvedValueOnce({ ok: true });
      const wrapper = mountPage();
      await flushPromises();

      await button(wrapper, 'Test connection')!.trigger('click');
      await flushPromises();
      expect(wrapper.findComponent({ name: 'VAlert' }).exists()).toBe(true);

      await button(wrapper, 'Save settings')!.trigger('click');
      await flushPromises();

      expect(wrapper.findComponent({ name: 'VAlert' }).exists()).toBe(false);
    });
  });

  // The background poller's health record (GET /api/jira-settings -> lastSync).
  // Distinct from the connection test above: nobody pressed a button, this is what
  // the timer last reported.
  describe('background-sync health banner', () => {
    // The banner sits at the top of the settings card; the test-result banner lives
    // in the second card. Match on content so the two can never be confused.
    function syncAlert(wrapper: VueWrapper) {
      return wrapper
        .findAllComponents({ name: 'VAlert' })
        .find((a) => a.text().includes('synchronization has been failing'));
    }

    const FAILING_AT = '2026-08-10T07:30:00.000Z';

    it('warns with the mapped reason and the since-when for a recorded failure', async () => {
      mockedApi.get.mockResolvedValue(
        masked({ enabled: true, hasToken: true, lastSync: { ok: false, reason: 'invalid_credentials', at: FAILING_AT } })
      );
      const wrapper = mountPage();
      await flushPromises();

      const alert = syncAlert(wrapper);
      expect(alert).toBeDefined();
      expect(alert!.props('type')).toBe('warning');
      // The reason comes from the EXISTING closed-code catalog, not from server text.
      expect(alert!.text()).toContain('Invalid credentials — check the account email and API token.');
      // ...and the timestamp is rendered through the locale formatter (asserted
      // timezone-independently).
      expect(alert!.text()).toContain('2026');
    });

    // The key-rotation case an admin is most likely to meet.
    it('maps config_error like every other closed code', async () => {
      mockedApi.get.mockResolvedValue(
        masked({ enabled: true, hasToken: true, lastSync: { ok: false, reason: 'config_error', at: FAILING_AT } })
      );
      const wrapper = mountPage();
      await flushPromises();

      expect(syncAlert(wrapper)!.text()).toContain('Jira is disabled or not configured');
    });

    it('falls back to the generic wording for a code it does not know', async () => {
      mockedApi.get.mockResolvedValue(
        masked({
          enabled: true,
          hasToken: true,
          // A reason from a newer backend: unmapped, so the te() guard takes over.
          lastSync: { ok: false, reason: 'brand_new_reason' as never, at: FAILING_AT },
        })
      );
      const wrapper = mountPage();
      await flushPromises();

      const alert = syncAlert(wrapper);
      expect(alert!.text()).toContain('see the server logs for details');
      // The raw code itself is never rendered.
      expect(alert!.text()).not.toContain('brand_new_reason');
    });

    it('renders the Slovak wording under the SK locale', async () => {
      mockedApi.get.mockResolvedValue(
        masked({ enabled: true, hasToken: true, lastSync: { ok: false, reason: 'timeout', at: FAILING_AT } })
      );
      const wrapper = mount(JiraSettingsPage, {
        global: { plugins: [createTestVuetify(), createTestI18n('sk')] },
      });
      await flushPromises();

      expect(wrapper.text()).toContain('Synchronizácia s Jirou zlyháva od');
    });

    it.each([
      ['a healthy record', { ok: true, at: FAILING_AT }],
      ['nothing recorded yet', null],
      ['a response without the field', undefined],
    ])('shows no banner for %s', async (_label, lastSync) => {
      mockedApi.get.mockResolvedValue(masked({ enabled: true, hasToken: true, lastSync }));
      const wrapper = mountPage();
      await flushPromises();

      expect(syncAlert(wrapper)).toBeUndefined();
    });
  });
});
