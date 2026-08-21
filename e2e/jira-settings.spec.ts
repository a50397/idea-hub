import { test, expect } from './support/test-fixtures';
import { API_BASE, MOCK_JIRA_IDENTITY, MOCK_JIRA_PROJECT_KEY, storageStatePath } from './support/config';
import { withFileLock, SETTINGS_LOCK } from './support/file-lock';
import type { APIRequestContext } from '@playwright/test';

/**
 * Admin Jira integration settings through the real UI (WebexSettingsPage-style
 * form, the THIRD admin-managed channel): mirrors mail-settings.spec.ts /
 * webex-settings.spec.ts's "admin configures + it persists masked" flow, plus the
 * projects picker (GET /jira-settings/projects) and the F2 credential-binding rule
 * this channel uniquely enforces (security review F2, P1) — changing baseUrl or
 * email while a token is already stored must re-require the token, otherwise a
 * saved credential could be silently re-pointed at an attacker-chosen origin.
 *
 * The DB-stored `baseUrl` saved here must be a valid https/non-IP/non-localhost
 * origin (the PUT schema rejects anything else, security review F1) — the REAL
 * mock Jira target is carried by the JIRA_API_BASE_URL env override
 * (support/config.ts BACKEND_ENV), which wins over this value for every outbound
 * call AND the browse URL (F7). The email/token typed into the form must be
 * MOCK_JIRA_IDENTITY, the exact credential support/mock-jira.mjs was started with
 * (support/config.ts MOCK_JIRA_ENV) — otherwise the mock 401s and "Test
 * connection" / the projects picker would fail even though the save itself
 * succeeded, which is what makes a successful test-connection here an implicit
 * proof the backend sent the exact Basic header this page configured.
 *
 * Shares SETTINGS_LOCK with mail-settings.spec.ts / notifications.spec.ts /
 * webex-settings.spec.ts (and idea-lifecycle.spec.ts, the other Jira-mutating
 * spec) so no two specs mutate a global settings singleton concurrently.
 *
 * Fields are located by ROLE + accessible NAME (`getByRole('textbox'/'combobox',
 * { name: <label> })`), not `.v-input({ hasText: <label> })`: the app's own hint
 * text under the API token field briefly (and, on this page, sometimes durably —
 * see the final report) contains the substring "account email" as part of the F2
 * identity-change message, which would make a `hasText`-based "Account email"
 * locator ambiguous against the API token field too. Role/name matching only ever
 * considers the field's actual label, never adjacent hint/help text.
 *
 * Every `getByText(...).toBeVisible()` presence check below takes `.first()`:
 * this page legitimately shows some confirmation strings in TWO places at once by
 * design (POST /test's result is shown both in a persistent inline alert AND a
 * transient snackbar with identical text — see "Connection succeeded." below),
 * and separately exhibits a message-region rendering quirk where a stale hint
 * node can persist alongside the current one (see the final report) — neither is
 * this test's concern, which only needs to confirm the text appears somewhere.
 */
test.use({ storageState: storageStatePath('admin') });

const BASE_URL_1 = 'https://mock-jira.example.com';
const BASE_URL_2 = 'https://mock-jira-2.example.com';
const DEFAULT_CANCEL_RESOLUTIONS = "Won't Do,Cancelled,Duplicate";

const resetPayload = {
  enabled: false,
  baseUrl: '',
  email: '',
  defaultProjectKey: '',
  issueTypeName: 'Task',
  pollIntervalMinutes: 5,
  cancelResolutions: DEFAULT_CANCEL_RESOLUTIONS,
  apiToken: '',
};

async function putJiraSettings(request: APIRequestContext, data: Record<string, unknown>): Promise<void> {
  const res = await request.put(`${API_BASE}/jira-settings`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    data,
  });
  expect(res.ok(), `jira-settings PUT failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

test('admin configures Jira settings, save persists masked, test connection succeeds, the projects picker loads, and the F2 identity-change rule is enforced', async ({
  page,
}) => {
  await withFileLock(SETTINGS_LOCK, async () => {
    try {
      // Known starting point regardless of ambient state / a retry: disabled + wiped.
      await putJiraSettings(page.request, resetPayload);

      await page.goto('/jira-settings');
      await expect(page.getByRole('heading', { level: 1, name: 'Jira Settings' })).toBeVisible();

      // Field locators by role + accessible name — stable across reloads and
      // immune to the hint-text collision described above.
      const enableSwitch = page.getByRole('checkbox', { name: 'Enable Jira integration' });
      const baseUrlInput = page.getByRole('textbox', { name: 'Jira base URL' });
      const emailInput = page.getByRole('textbox', { name: 'Account email' });
      const tokenInput = page.getByRole('textbox', { name: 'API token' });
      const projectInput = page.getByRole('combobox', { name: 'Default project key' });

      // check() targets the INPUT (Vuetify switch pitfall: clicking the wrapper
      // hits dead space to the right) — getByRole resolves straight to it.
      await enableSwitch.check();
      await expect(enableSwitch).toBeChecked();

      await baseUrlInput.fill(BASE_URL_1);
      await emailInput.fill(MOCK_JIRA_IDENTITY.email);
      await tokenInput.fill(MOCK_JIRA_IDENTITY.apiToken);

      // Default project key: a combobox fed by GET /projects. On this FIRST save
      // Jira is not yet effectively enabled (nothing saved yet), so the picker has
      // nothing loaded and this exercises the manual-entry fallback (always also
      // offered — the Webex-rooms-picker precedent). Real keystrokes (not fill),
      // like the department Webex/notification-email combobox specs: Vuetify's
      // combobox tracks pending text from key events, not a programmatic value set.
      await projectInput.click();
      await projectInput.pressSequentially(MOCK_JIRA_PROJECT_KEY);

      await page.getByRole('button', { name: 'Save settings' }).click();
      await expect(page.getByText('Jira settings saved successfully!').first()).toBeVisible();

      // Reload: enabled/baseUrl/email/project persist, and — since the token is
      // write-only — the token field is empty with the "token saved" hint (never
      // "no token").
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Jira Settings' })).toBeVisible();
      await expect(enableSwitch).toBeChecked();
      await expect(baseUrlInput).toHaveValue(BASE_URL_1);
      await expect(emailInput).toHaveValue(MOCK_JIRA_IDENTITY.email);
      await expect(tokenInput).toHaveValue('');
      await expect(page.getByText('A token is saved').first()).toBeVisible();

      // Hint-uniqueness regression: JiraSettingsPage.vue used to sync `settings`
      // (store) and `form` (local) in two separate render passes on mount, so the
      // token field's hint region briefly rendered the F2 re-entry warning against
      // the not-yet-synced form before settling — leaving stale message nodes
      // behind (the "message-region rendering quirk" noted above). Follow the
      // field's own aria-describedby (the same link an accessibility snapshot
      // would follow) and require exactly one message node, not just that "A token
      // is saved" appears somewhere among possibly-orphaned siblings.
      const tokenMessagesId = await tokenInput.getAttribute('aria-describedby');
      await expect(page.locator(`#${tokenMessagesId} .v-messages__message`)).toHaveCount(1);

      // The projects picker now loads FOR REAL: the settings are effectively
      // enabled (enabled + baseUrl/email/token all set), so GET /projects reaches
      // support/mock-jira.mjs (through the JIRA_API_BASE_URL override) and returns
      // its fixed catalog. Once the current value resolves to a known item,
      // Vuetify displays that item's "KEY — Name" title rather than the bare key
      // (this mock's fixed catalog always pairs MOCK_JIRA_PROJECT_KEY with
      // "Operations" — see support/mock-jira.mjs), so match on the key prefix
      // rather than an exact key-only string. The hint text is the definitive
      // "it loaded" signal: it reads the plain "select a project" copy only once a
      // NON-EMPTY list actually loaded — any failure instead shows the "couldn't
      // load" fallback.
      await expect(projectInput).toHaveValue(new RegExp(`^${MOCK_JIRA_PROJECT_KEY}\\b`));
      await expect(page.getByText('Select a project or enter a project key').first()).toBeVisible();
      await expect(page.getByText("Couldn't load Jira projects")).toHaveCount(0);

      // Test connection: GET /rest/api/3/myself against the mock, with the exact
      // credential just saved.
      await page.getByRole('button', { name: 'Test connection' }).click();
      await expect(page.getByText('Connection succeeded.').first()).toBeVisible();

      // -----------------------------------------------------------------------
      // F2 (security review, P1): changing baseUrl/email while a token is already
      // stored must re-require the token — otherwise a saved credential could be
      // silently re-pointed at an attacker-chosen origin.
      // -----------------------------------------------------------------------

      // (1) The real form: change baseUrl only (token field left blank, wipe
      // checkbox unchecked) and Save. The FE mirrors the backend rule
      // client-side, so the save is refused BEFORE any request is sent and the
      // identity-change message becomes visible.
      await baseUrlInput.fill(BASE_URL_2);
      await page.getByRole('button', { name: 'Save settings' }).click();
      await expect(
        page.getByText('Changing the base URL or account email requires re-entering the API token').first()
      ).toBeVisible();

      // (2) Direct backend proof, independent of the FE mirror above: the exact
      // same change with `apiToken` OMITTED (KEEP semantics) is refused with a
      // real 400 and the house error message.
      const directAttempt = await page.request.put(`${API_BASE}/jira-settings`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        data: {
          enabled: true,
          baseUrl: BASE_URL_2,
          email: MOCK_JIRA_IDENTITY.email,
          defaultProjectKey: MOCK_JIRA_PROJECT_KEY,
          issueTypeName: 'Task',
          pollIntervalMinutes: 5,
          cancelResolutions: DEFAULT_CANCEL_RESOLUTIONS,
          // apiToken deliberately absent.
        },
      });
      expect(directAttempt.status()).toBe(400);
      expect((await directAttempt.json()).error).toContain('requires re-entering the API token');

      // Neither attempt above changed anything.
      await page.reload();
      await expect(baseUrlInput).toHaveValue(BASE_URL_1);
      await expect(page.getByText('A token is saved').first()).toBeVisible();

      // (3) Re-entering the token alongside the new baseUrl clears the rule and
      // the save succeeds — "until token re-entered".
      await baseUrlInput.fill(BASE_URL_2);
      await tokenInput.fill(MOCK_JIRA_IDENTITY.apiToken);
      await page.getByRole('button', { name: 'Save settings' }).click();
      await expect(page.getByText('Jira settings saved successfully!').first()).toBeVisible();
    } finally {
      // Restore: disabled + wiped, so no later spec (or a retry of this one)
      // inherits an enabled Jira channel or a stored token.
      await putJiraSettings(page.request, resetPayload);
    }
  });
});
