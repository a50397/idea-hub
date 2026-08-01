import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import MailSettingsPage from '../pages/MailSettingsPage.vue';
import { useAuthStore } from '../stores/auth';
import { Role } from '../types';
import type { MailSettings } from '../types';
import { createTestI18n, createTestVuetify } from './helpers';

vi.mock('../api/mailSettings', () => ({
  mailSettingsApi: {
    get: vi.fn(),
    update: vi.fn(),
    sendTest: vi.fn(),
  },
}));

import { mailSettingsApi } from '../api/mailSettings';
const mockedApi = vi.mocked(mailSettingsApi);

function masked(overrides: Partial<MailSettings> = {}): MailSettings {
  return {
    enabled: false,
    host: '',
    port: 587,
    secure: false,
    username: '',
    from: 'IdeaHub <no-reply@ideahub.local>',
    language: 'en',
    subjectTemplate: '',
    hasPassword: false,
    ...overrides,
  };
}

function mountPage() {
  return mount(MailSettingsPage, {
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

describe('MailSettingsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockedApi.get.mockResolvedValue(masked());
    mockedApi.update.mockResolvedValue(masked());
    mockedApi.sendTest.mockResolvedValue({ status: 'sent' });
  });

  it('loads the masked settings on mount and shows the "no password saved" hint', async () => {
    mockedApi.get.mockResolvedValue(masked({ enabled: true, host: 'smtp.corp.example', username: 'relay-user' }));
    const wrapper = mountPage();
    await flushPromises();

    expect(mockedApi.get).toHaveBeenCalledTimes(1);
    expect(fieldByLabel(wrapper, 'SMTP host')!.props('modelValue')).toBe('smtp.corp.example');
    // Password is write-only: never populated from the server.
    expect(fieldByLabel(wrapper, 'Password')!.props('modelValue')).toBe('');
    expect(wrapper.text()).toContain('No password saved');
  });

  it('shows the "saved — leave blank to keep" hint when a password is already stored', async () => {
    mockedApi.get.mockResolvedValue(masked({ hasPassword: true }));
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('A password is saved');
    expect(fieldByLabel(wrapper, 'Password')!.props('modelValue')).toBe('');
  });

  it('prefills the test recipient with the admin\'s own email', async () => {
    const auth = useAuthStore();
    auth.user = { id: 'a1', name: 'Admin', email: 'admin@corp.example', role: Role.ADMIN };
    const wrapper = mountPage();
    await flushPromises();

    expect(fieldByLabel(wrapper, 'Recipient email')!.props('modelValue')).toBe('admin@corp.example');
  });

  it('saves WITHOUT a password key when the password field is left blank', async () => {
    mockedApi.get.mockResolvedValue(masked({ host: 'smtp.corp.example' }));
    const wrapper = mountPage();
    await flushPromises();

    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).toHaveBeenCalledTimes(1);
    const payload = mockedApi.update.mock.calls[0][0];
    expect(payload).not.toHaveProperty('password');
    expect(payload).toMatchObject({ host: 'smtp.corp.example', enabled: false });
  });

  it('includes the password in the payload when the admin types one', async () => {
    mockedApi.get.mockResolvedValue(masked({ host: 'smtp.corp.example', username: 'relay-user' }));
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Password', 'brand-new-secret');
    await flushPromises();

    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).toHaveBeenCalledTimes(1);
    expect(mockedApi.update.mock.calls[0][0]).toMatchObject({ password: 'brand-new-secret' });
  });

  it('RETAINS the typed password and surfaces an error when the save fails', async () => {
    mockedApi.get.mockResolvedValue(masked({ host: 'smtp.corp.example', username: 'relay-user' }));
    // The PUT rejects; the store returns false and exposes the server error.
    mockedApi.update.mockRejectedValueOnce({ response: { data: { error: 'SMTP relay refused' } } });
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Password', 'kept-secret');
    await flushPromises();

    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).toHaveBeenCalledTimes(1);
    // The secret is deliberately kept so the admin can fix an unrelated field and
    // retry without re-typing it.
    expect(fieldByLabel(wrapper, 'Password')!.props('modelValue')).toBe('kept-secret');
    // The failure is surfaced through the error snackbar.
    const snackbar = wrapper.findComponent({ name: 'VSnackbar' });
    expect(snackbar.props('modelValue')).toBe(true);
    expect(snackbar.props('color')).toBe('error');
    expect(document.body.textContent).toContain('SMTP relay refused');
  });

  it('CLEARS the password and refreshes the hint after a successful save', async () => {
    mockedApi.get.mockResolvedValue(masked({ host: 'smtp.corp.example', username: 'relay-user', hasPassword: false }));
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('No password saved');

    setField(wrapper, 'Password', 'brand-new-secret');
    await flushPromises();

    // The server now reports a stored password; applySettings() clears the field
    // and the hint recomputes.
    mockedApi.update.mockResolvedValueOnce(
      masked({ host: 'smtp.corp.example', username: 'relay-user', hasPassword: true })
    );
    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).toHaveBeenCalledTimes(1);
    expect(fieldByLabel(wrapper, 'Password')!.props('modelValue')).toBe('');
    expect(wrapper.text()).toContain('A password is saved');
  });

  it('blocks the save with an inline error when enabled but the host is empty', async () => {
    mockedApi.get.mockResolvedValue(masked({ enabled: true, host: '' }));
    const wrapper = mountPage();
    await flushPromises();

    await button(wrapper, 'Save settings')!.trigger('click');
    await flushPromises();

    expect(mockedApi.update).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('An SMTP host is required when email is enabled');
  });

  it('sends a test email and surfaces a success result', async () => {
    mockedApi.sendTest.mockResolvedValueOnce({ status: 'sent' });
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Recipient email', 'ops@corp.example');
    await flushPromises();

    await button(wrapper, 'Send test email')!.trigger('click');
    await flushPromises();

    expect(mockedApi.sendTest).toHaveBeenCalledWith('ops@corp.example');
    expect(wrapper.text()).toContain('Test email sent successfully.');
    expect(wrapper.findComponent({ name: 'VAlert' }).props('type')).toBe('success');
  });

  it('surfaces a failed test send with the reason-specific message (auth_failed)', async () => {
    mockedApi.sendTest.mockResolvedValueOnce({ status: 'failed', reason: 'auth_failed' });
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Recipient email', 'ops@corp.example');
    await flushPromises();

    await button(wrapper, 'Send test email')!.trigger('click');
    await flushPromises();

    expect(mockedApi.sendTest).toHaveBeenCalledWith('ops@corp.example');
    // The fixed reason category is translated to a friendly, admin-facing message.
    expect(wrapper.text()).toContain('Authentication failed');
    expect(wrapper.findComponent({ name: 'VAlert' }).props('type')).toBe('error');
  });

  it('maps the connection_refused reason to its own message', async () => {
    mockedApi.sendTest.mockResolvedValueOnce({ status: 'failed', reason: 'connection_refused' });
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Recipient email', 'ops@corp.example');
    await flushPromises();

    await button(wrapper, 'Send test email')!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Connection refused');
  });

  it('shows an informational (warning) banner when mail is disabled', async () => {
    mockedApi.sendTest.mockResolvedValueOnce({ status: 'disabled' });
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Recipient email', 'ops@corp.example');
    await flushPromises();

    await button(wrapper, 'Send test email')!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Email is disabled');
    // Disabled is neither success nor error — it renders as a warning.
    expect(wrapper.findComponent({ name: 'VAlert' }).props('type')).toBe('warning');
  });

  it('surfaces a request-level failure (store returns null) as an error', async () => {
    mockedApi.sendTest.mockRejectedValueOnce({ response: { data: { error: 'Server exploded' } } });
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Recipient email', 'ops@corp.example');
    await flushPromises();

    await button(wrapper, 'Send test email')!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Server exploded');
    expect(wrapper.findComponent({ name: 'VAlert' }).props('type')).toBe('error');
  });

  it('does not call the API for an invalid test recipient', async () => {
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Recipient email', 'not-an-email');
    await flushPromises();

    await button(wrapper, 'Send test email')!.trigger('click');
    await flushPromises();

    expect(mockedApi.sendTest).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Enter a valid email address');
  });

  it('clears the stale test-result banner when settings are saved', async () => {
    // A successful test leaves a green banner; saving DIFFERENT settings without
    // re-testing must drop it so it can't imply the freshly-saved config was verified.
    mockedApi.sendTest.mockResolvedValueOnce({ status: 'sent' });
    const wrapper = mountPage();
    await flushPromises();

    setField(wrapper, 'Recipient email', 'ops@corp.example');
    await flushPromises();
    await button(wrapper, 'Send test email')!.trigger('click');
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
    let resolveGet!: (value: MailSettings) => void;
    mockedApi.get.mockReturnValueOnce(new Promise<MailSettings>((res) => { resolveGet = res; }));
    const wrapper = mountPage();
    await flushPromises();

    // While the fetch is in flight, the controls are disabled so the in-flight
    // applySettings() cannot clobber an admin's in-progress edits.
    expect(wrapper.findComponent({ name: 'VSwitch' }).props('disabled')).toBe(true);
    expect(fieldByLabel(wrapper, 'Password')!.props('disabled')).toBe(true);
    expect(button(wrapper, 'Save settings')!.props('disabled')).toBe(true);

    // Once the settings arrive (loading → false) the controls become editable.
    resolveGet(masked());
    await flushPromises();

    expect(wrapper.findComponent({ name: 'VSwitch' }).props('disabled')).toBe(false);
    expect(fieldByLabel(wrapper, 'Password')!.props('disabled')).toBe(false);
    expect(button(wrapper, 'Save settings')!.props('disabled')).toBe(false);
  });
});
