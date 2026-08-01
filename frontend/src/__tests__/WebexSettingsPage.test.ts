import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import WebexSettingsPage from '../pages/WebexSettingsPage.vue';
import { useAuthStore } from '../stores/auth';
import { Role } from '../types';
import type { WebexSettings } from '../types';
import { createTestI18n, createTestVuetify } from './helpers';

vi.mock('../api/webexSettings', () => ({
  webexSettingsApi: {
    get: vi.fn(),
    update: vi.fn(),
    sendTest: vi.fn(),
  },
}));

import { webexSettingsApi } from '../api/webexSettings';
const mockedApi = vi.mocked(webexSettingsApi);

function masked(overrides: Partial<WebexSettings> = {}): WebexSettings {
  return {
    enabled: false,
    language: 'sk',
    hasToken: false,
    ...overrides,
  };
}

function mountPage() {
  return mount(WebexSettingsPage, {
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

describe('WebexSettingsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockedApi.get.mockResolvedValue(masked());
    mockedApi.update.mockResolvedValue(masked());
    mockedApi.sendTest.mockResolvedValue({ ok: true });
  });

  it('loads the masked settings on mount and shows the "no token saved" hint', async () => {
    mockedApi.get.mockResolvedValue(masked({ enabled: true, hasToken: false, language: 'en' }));
    const wrapper = mountPage();
    await flushPromises();

    expect(mockedApi.get).toHaveBeenCalledTimes(1);
    // Token is write-only: never populated from the server.
    expect(fieldByLabel(wrapper, 'Bot access token')!.props('modelValue')).toBe('');
    expect(wrapper.text()).toContain('No token saved');
  });

  it('shows the "saved — leave blank to keep" hint when a token is already stored', async () => {
    mockedApi.get.mockResolvedValue(masked({ hasToken: true }));
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('A token is saved');
    expect(fieldByLabel(wrapper, 'Bot access token')!.props('modelValue')).toBe('');
  });

  it("prefills the test recipient with the admin's own email", async () => {
    const auth = useAuthStore();
    auth.user = { id: 'a1', name: 'Admin', email: 'admin@corp.example', role: Role.ADMIN };
    const wrapper = mountPage();
    await flushPromises();

    expect(fieldByLabel(wrapper, 'Recipient email')!.props('modelValue')).toBe('admin@corp.example');
  });

  it('KEEPS the stored token (omits the token key) when the field is left blank', async () => {
    // Enabled with a token already stored: saving without re-typing must keep it and
    // must NOT be blocked by the enabled-requires-token guard.
    mockedApi.get.mockResolvedValue(masked({ enabled: true, hasToken: true }));
    const wrapper = mountPage();
    await flushPromises();

    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).toHaveBeenCalledTimes(1);
    const payload = mockedApi.update.mock.calls[0][0];
    expect(payload).not.toHaveProperty('token');
    expect(payload).toMatchObject({ enabled: true });
  });

  it('SETS the token (sends it) when the admin types one', async () => {
    // Enabled + no stored token + a freshly typed token: the guard passes and the
    // new token is sent.
    mockedApi.get.mockResolvedValue(masked({ enabled: true, hasToken: false }));
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Bot access token', 'brand-new-bot-token');
    await flushPromises();

    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).toHaveBeenCalledTimes(1);
    expect(mockedApi.update.mock.calls[0][0]).toMatchObject({ token: 'brand-new-bot-token' });
  });

  it('WIPES the token (sends an empty string) when the clear-token box is checked', async () => {
    // Disabled + a stored token: opting to clear sends token: '' so the server wipes it.
    mockedApi.get.mockResolvedValue(masked({ enabled: false, hasToken: true }));
    const wrapper = mountPage();
    await flushPromises();

    clearTokenCheckbox(wrapper).vm.$emit('update:modelValue', true);
    await flushPromises();

    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).toHaveBeenCalledTimes(1);
    expect(mockedApi.update.mock.calls[0][0]).toHaveProperty('token', '');
  });

  it('WIPES even when a token was TYPED first: clear-token wins over the leftover text', async () => {
    // The exact shipped-bug combination: type a token, THEN check clear-token. The
    // wipe must win — the payload carries token: '' and never the typed value.
    // (Disabled so the enabled-requires-token guard does not block this path.)
    mockedApi.get.mockResolvedValue(masked({ enabled: false, hasToken: true }));
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Bot access token', 'typed-then-abandoned');
    await flushPromises();
    clearTokenCheckbox(wrapper).vm.$emit('update:modelValue', true);
    await flushPromises();

    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).toHaveBeenCalledTimes(1);
    const payload = mockedApi.update.mock.calls[0][0];
    expect(payload).toHaveProperty('token', '');
    expect(payload.token).not.toBe('typed-then-abandoned');
  });

  it('empties the visible token field the moment clear-token is checked', async () => {
    mockedApi.get.mockResolvedValue(masked({ enabled: false, hasToken: true }));
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Bot access token', 'about-to-be-cleared');
    await flushPromises();
    expect(fieldByLabel(wrapper, 'Bot access token')!.props('modelValue')).toBe('about-to-be-cleared');

    clearTokenCheckbox(wrapper).vm.$emit('update:modelValue', true);
    await flushPromises();

    // The watcher clears the model so the field never disagrees with the wipe intent.
    expect(fieldByLabel(wrapper, 'Bot access token')!.props('modelValue')).toBe('');
  });

  it('surfaces the enabled-requires-token guard on the CLEAR-TOKEN checkbox (not just the disabled field)', async () => {
    // Enabled + a stored token + opting to clear it + nothing typed: the guard fires,
    // and because the token field is disabled by the wipe, the message must ALSO show
    // on the checkbox the admin actually used.
    mockedApi.get.mockResolvedValue(masked({ enabled: true, hasToken: true }));
    const wrapper = mountPage();
    await flushPromises();

    clearTokenCheckbox(wrapper).vm.$emit('update:modelValue', true);
    await flushPromises();

    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).not.toHaveBeenCalled();
    expect(clearTokenCheckbox(wrapper).props('errorMessages')).toContain(
      'A bot access token is required when Webex is enabled'
    );
  });

  it('recovers after unchecking clear and typing a token: save succeeds and the guard clears', async () => {
    mockedApi.get.mockResolvedValue(masked({ enabled: true, hasToken: true }));
    const wrapper = mountPage();
    await flushPromises();

    // Check clear + save → the guard blocks and shows on the checkbox.
    clearTokenCheckbox(wrapper).vm.$emit('update:modelValue', true);
    await flushPromises();
    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();
    expect(mockedApi.update).not.toHaveBeenCalled();
    expect(clearTokenCheckbox(wrapper).props('errorMessages')).toContain(
      'A bot access token is required when Webex is enabled'
    );

    // Uncheck clear, type a fresh token → save now succeeds, the token is sent, and
    // the guard error is cleared from the field.
    clearTokenCheckbox(wrapper).vm.$emit('update:modelValue', false);
    await flushPromises();
    setField(wrapper, 'Bot access token', 'fresh-token');
    await flushPromises();
    mockedApi.update.mockResolvedValueOnce(masked({ enabled: true, hasToken: true }));
    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).toHaveBeenCalledTimes(1);
    expect(mockedApi.update.mock.calls[0][0]).toMatchObject({ token: 'fresh-token' });
    expect(fieldByLabel(wrapper, 'Bot access token')!.props('errorMessages')).toEqual([]);
  });

  it('blocks the save with an inline error when enabled but no token is stored or typed', async () => {
    mockedApi.get.mockResolvedValue(masked({ enabled: true, hasToken: false }));
    const wrapper = mountPage();
    await flushPromises();

    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('A bot access token is required when Webex is enabled');
  });

  it('RETAINS the typed token and surfaces an error when the save fails', async () => {
    mockedApi.get.mockResolvedValue(masked({ enabled: true, hasToken: true }));
    mockedApi.update.mockRejectedValueOnce({ response: { data: { error: 'Webex API rejected' } } });
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Bot access token', 'kept-token');
    await flushPromises();

    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).toHaveBeenCalledTimes(1);
    // The secret is deliberately kept so the admin can fix an unrelated field and retry.
    expect(fieldByLabel(wrapper, 'Bot access token')!.props('modelValue')).toBe('kept-token');
    const snackbar = wrapper.findComponent({ name: 'VSnackbar' });
    expect(snackbar.props('modelValue')).toBe(true);
    expect(snackbar.props('color')).toBe('error');
    expect(document.body.textContent).toContain('Webex API rejected');
  });

  it('CLEARS the token and refreshes the hint after a successful save', async () => {
    mockedApi.get.mockResolvedValue(masked({ enabled: true, hasToken: false }));
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('No token saved');

    setField(wrapper, 'Bot access token', 'brand-new-bot-token');
    await flushPromises();

    // The server now reports a stored token; applySettings() clears the field and
    // the hint recomputes.
    mockedApi.update.mockResolvedValueOnce(masked({ enabled: true, hasToken: true }));
    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).toHaveBeenCalledTimes(1);
    expect(fieldByLabel(wrapper, 'Bot access token')!.props('modelValue')).toBe('');
    expect(wrapper.text()).toContain('A token is saved');
  });

  it('sends a test message and surfaces a success result', async () => {
    mockedApi.sendTest.mockResolvedValueOnce({ ok: true });
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Recipient email', 'ops@corp.example');
    await flushPromises();

    await button(wrapper, 'Send test message')!.trigger('click');
    await flushPromises();

    expect(mockedApi.sendTest).toHaveBeenCalledWith('ops@corp.example');
    expect(wrapper.text()).toContain('Test message sent successfully.');
    expect(wrapper.findComponent({ name: 'VAlert' }).props('type')).toBe('success');
  });

  it('surfaces a failed test send with the reason-specific message (invalid_token)', async () => {
    mockedApi.sendTest.mockResolvedValueOnce({ ok: false, reason: 'invalid_token' });
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Recipient email', 'ops@corp.example');
    await flushPromises();

    await button(wrapper, 'Send test message')!.trigger('click');
    await flushPromises();

    expect(mockedApi.sendTest).toHaveBeenCalledWith('ops@corp.example');
    // The fixed reason category is translated to a friendly, admin-facing message.
    expect(wrapper.text()).toContain('Invalid bot token');
    expect(wrapper.findComponent({ name: 'VAlert' }).props('type')).toBe('error');
  });

  it('maps the config_error reason (disabled/not configured) to its own message', async () => {
    mockedApi.sendTest.mockResolvedValueOnce({ ok: false, reason: 'config_error' });
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Recipient email', 'ops@corp.example');
    await flushPromises();

    await button(wrapper, 'Send test message')!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Webex is disabled or not configured');
  });

  it('maps the recipient_not_found reason to its own message', async () => {
    mockedApi.sendTest.mockResolvedValueOnce({ ok: false, reason: 'recipient_not_found' });
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Recipient email', 'ops@corp.example');
    await flushPromises();

    await button(wrapper, 'Send test message')!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Recipient not found');
  });

  it('maps the new host_not_found transport reason to its own message (not the unknown fallback)', async () => {
    mockedApi.sendTest.mockResolvedValueOnce({ ok: false, reason: 'host_not_found' });
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Recipient email', 'ops@corp.example');
    await flushPromises();

    await button(wrapper, 'Send test message')!.trigger('click');
    await flushPromises();

    // The freshly-added key resolves to its OWN localized message; it must not fall
    // back to the generic 'unknown' wording (which would mean the key is missing).
    expect(wrapper.text()).toContain('Could not reach the Webex service');
    expect(wrapper.text()).not.toContain('see the server logs');
    expect(wrapper.findComponent({ name: 'VAlert' }).props('type')).toBe('error');
  });

  it('maps the new rate_limited reason to its own message (not the unknown fallback)', async () => {
    mockedApi.sendTest.mockResolvedValueOnce({ ok: false, reason: 'rate_limited' });
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Recipient email', 'ops@corp.example');
    await flushPromises();

    await button(wrapper, 'Send test message')!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('rate limit');
    expect(wrapper.text()).not.toContain('see the server logs');
  });

  it('surfaces a request-level failure (store returns null) as an error', async () => {
    mockedApi.sendTest.mockRejectedValueOnce({ response: { data: { error: 'Server exploded' } } });
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Recipient email', 'ops@corp.example');
    await flushPromises();

    await button(wrapper, 'Send test message')!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Server exploded');
    expect(wrapper.findComponent({ name: 'VAlert' }).props('type')).toBe('error');
  });

  it('does not call the API for an invalid test recipient', async () => {
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Recipient email', 'not-an-email');
    await flushPromises();

    await button(wrapper, 'Send test message')!.trigger('click');
    await flushPromises();

    expect(mockedApi.sendTest).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Enter a valid email address');
  });

  it('clears the stale test-result banner when settings are saved', async () => {
    // A successful test leaves a green banner; saving DIFFERENT settings without
    // re-testing must drop it so it can't imply the freshly-saved config was verified.
    mockedApi.sendTest.mockResolvedValueOnce({ ok: true });
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Recipient email', 'ops@corp.example');
    await flushPromises();
    await button(wrapper, 'Send test message')!.trigger('click');
    await flushPromises();
    // The inline success banner is showing.
    expect(wrapper.findComponent({ name: 'VAlert' }).exists()).toBe(true);

    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    // save() resets testResult → the banner is gone.
    expect(wrapper.findComponent({ name: 'VAlert' }).exists()).toBe(false);
  });

  it('disables the interactive controls while the initial settings fetch is in flight', async () => {
    // Hold the GET open so the store's fetch-loading ref stays true.
    let resolveGet!: (value: WebexSettings) => void;
    mockedApi.get.mockReturnValueOnce(new Promise<WebexSettings>((res) => { resolveGet = res; }));
    const wrapper = mountPage();
    await flushPromises();

    // While the fetch is in flight, the controls are disabled so the in-flight
    // applySettings() cannot clobber an admin's in-progress edits.
    expect(wrapper.findComponent({ name: 'VSwitch' }).props('disabled')).toBe(true);
    expect(fieldByLabel(wrapper, 'Bot access token')!.props('disabled')).toBe(true);
    expect(button(wrapper, 'Save settings')!.props('disabled')).toBe(true);

    // Once the settings arrive (loading → false) the controls become editable.
    resolveGet(masked());
    await flushPromises();

    expect(wrapper.findComponent({ name: 'VSwitch' }).props('disabled')).toBe(false);
    expect(fieldByLabel(wrapper, 'Bot access token')!.props('disabled')).toBe(false);
    expect(button(wrapper, 'Save settings')!.props('disabled')).toBe(false);
  });
});
