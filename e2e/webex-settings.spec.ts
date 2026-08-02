import { test, expect } from './support/test-fixtures';
import { API_BASE, FRONTEND_URL, storageStatePath, type RoleKey } from './support/config';
import { withFileLock, SETTINGS_LOCK } from './support/file-lock';
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';

/**
 * The second notification channel (Webex) through the real UI.
 *
 *   (a) An admin configures Webex (enable + bot token + language), saves, and the
 *       config survives a reload — with the write-only token field staying empty and
 *       showing the "token saved" hint (never the "no token" hint).
 *   (b) The per-idea notify toggle is CHANNEL-AGNOSTIC: with mail disabled and Webex
 *       enabled it appears on the submit form and on an own idea's detail page, and
 *       with both channels disabled it is hidden.
 *
 * Both flows mutate the same global notification state (mail-settings.spec.ts and
 * notifications.spec.ts contend on the SINGLETON settings + the derived options the
 * notify toggle reads), so all mutating work runs under the SAME cross-worker lock
 * those specs use (support/file-lock.ts, name "mail-settings"): notifications.spec.ts
 * asserts "mail off ⇒ no toggle", which a concurrent Webex-enable here would break.
 * Every test restores mail + Webex to DISABLED in a finally so nothing is left
 * enabled for a later spec (or a retry).
 *
 * No test-DM button is ever clicked (no outbound sends); the idea in (b) is created
 * while BOTH channels are off, and the e2e backend black-holes WEBEX_API_BASE_URL
 * anyway (see support/config.ts), so no real Webex call can ever happen.
 */

const NOTIFY_LABEL = 'Notify me about changes to this idea';
const tokenInput = 'e2e-webex-bot-token-value';

// The notify switch, located by its label so the SAME locator resolves on both
// screens despite their different markup: on the create form the label sits inside
// the .v-switch, while the detail sidebar renders a settings-style .v-list-item row
// with the label on the left and the switch in the append slot. (Mirrors
// notifications.spec.ts.)
const notifySwitch = (page: Page) =>
  page
    .locator('.v-switch', { hasText: NOTIFY_LABEL })
    .or(page.locator('.v-list-item', { hasText: NOTIFY_LABEL }).locator('.v-switch'));

// A distinct forwarded IP per context so each lands in its own rate-limit bucket
// (mirrors support/test-fixtures.ts, which the hand-rolled contexts here bypass).
function randomForwardedFor(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

// A browser context restored from a seeded role's storage state, with the same
// forwarded-IP isolation and EN-locale seeding the shared fixture applies (the app
// defaults to Slovak, and the assertions below are English). (Mirrors
// notifications.spec.ts.)
async function roleContext(browser: Browser, role: RoleKey): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: FRONTEND_URL,
    storageState: storageStatePath(role),
  });
  await context.setExtraHTTPHeaders({ 'X-Forwarded-For': randomForwardedFor() });
  await context.addInitScript(() => {
    if (!localStorage.getItem('locale')) localStorage.setItem('locale', 'en');
  });
  return context;
}

// Save the Webex singleton via the admin API (state-changing → needs the CSRF
// header). `effectiveEnabled` (what the options flag exposes) is `enabled && token`,
// so a non-empty token is required when enabling; an empty-string token WIPES the
// stored one (the Webex analogue of the mail password's empty-string wipe). The
// token is a dummy — the e2e backend black-holes the Webex API, so it never sends.
async function setWebexSettings(
  request: APIRequestContext,
  opts: { enabled: boolean; token: string; language?: 'en' | 'sk' }
): Promise<void> {
  const res = await request.put(`${API_BASE}/webex-settings`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    data: { enabled: opts.enabled, language: opts.language ?? 'sk', token: opts.token },
  });
  expect(res.ok(), `webex-settings PUT failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

// Enable/disable outbound mail via the admin API (mirrors notifications.spec.ts).
// `effectiveEnabled` is `enabled && host`, so a non-empty host is required when
// enabling; the host is a dummy that never receives a send in this flow.
async function setMailEnabled(request: APIRequestContext, enabled: boolean): Promise<void> {
  const res = await request.put(`${API_BASE}/mail-settings`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    data: {
      enabled,
      host: enabled ? 'smtp.e2e.example' : '',
      port: 587,
      secure: false,
      username: '',
      from: 'IdeaHub <no-reply@ideahub.local>',
      language: 'en',
      subjectTemplate: '',
    },
  });
  expect(res.ok(), `mail-settings PUT failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

// Create an idea directly through the API (state-changing → needs the CSRF header),
// so (b) gets an own idea to open WITHOUT driving the create form while a channel is
// enabled. Returns the created idea (which carries its `id`).
async function createIdea(
  request: APIRequestContext,
  data: { title: string; description: string; benefits: string }
): Promise<{ id: string }> {
  const deptRes = await request.get(`${API_BASE}/departments`);
  expect(deptRes.ok(), `departments GET failed: ${deptRes.status()}`).toBeTruthy();
  const departments = (await deptRes.json()) as Array<{ id: string }>;
  expect(departments.length, 'expected at least one seeded department').toBeGreaterThan(0);

  const res = await request.post(`${API_BASE}/ideas`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    data: {
      title: data.title,
      description: data.description,
      benefits: data.benefits,
      effort: 'ONE_TO_THREE_DAYS',
      departmentId: departments[0].id,
      tags: [],
    },
  });
  expect(res.ok(), `ideas POST failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

// --- (a) Admin configures Webex and it persists ------------------------------------
// A dedicated admin page (mirrors mail-settings.spec.ts). test.use only affects this
// file's default `page`; test (b) creates its own role contexts and ignores it.
test.describe('Webex admin settings', () => {
  test.use({ storageState: storageStatePath('admin') });

  test('admin saves Webex settings and they persist on reload', async ({ page }) => {
    await withFileLock(SETTINGS_LOCK, async () => {
      try {
        // Known starting point (regardless of ambient state / a retry): Webex disabled
        // with no stored token, so the "no token" hint is the pre-save baseline.
        await setWebexSettings(page.request, { enabled: false, token: '' });

        await page.goto('/webex-settings');
        await expect(
          page.getByRole('heading', { level: 1, name: 'Webex Settings' })
        ).toBeVisible();

        // Enable, set a (dummy) bot token, and choose the English notification language.
        // check() must target the INPUT: clicking the .v-switch wrapper hits the
        // geometric center of the full-width v-input root — dead space to the right
        // of the control — and toggles nothing.
        const enableSwitch = page.locator('.v-switch', { hasText: 'Enable Webex notifications' });
        await enableSwitch.locator('input').check();
        await expect(enableSwitch.locator('input')).toBeChecked();
        await page.locator('.v-input', { hasText: 'Bot access token' }).locator('input').fill(tokenInput);
        await page.locator('.v-input', { hasText: 'Notification language' }).locator('.v-field').click();
        await page.getByRole('option', { name: 'English' }).click();

        await page.getByRole('button', { name: 'Save settings' }).click();
        await expect(page.getByText('Webex settings saved successfully!')).toBeVisible();

        // Reload: enabled + language persist, and — since the token is write-only —
        // the token field is empty and shows the "token saved" hint (never "no token").
        await page.reload();
        await expect(
          page.getByRole('heading', { level: 1, name: 'Webex Settings' })
        ).toBeVisible();
        await expect(
          page.locator('.v-switch', { hasText: 'Enable Webex notifications' }).locator('input')
        ).toBeChecked();

        const token = page.locator('.v-input', { hasText: 'Bot access token' }).locator('input');
        await expect(token).toHaveValue('');
        await expect(page.getByText('A token is saved')).toBeVisible();
        await expect(page.getByText('No token saved')).toHaveCount(0);
        await expect(page.locator('.v-input', { hasText: 'Notification language' })).toContainText(
          'English'
        );
      } finally {
        // Restore: disabled + token wiped, so no later spec inherits an enabled channel.
        await setWebexSettings(page.request, { enabled: false, token: '' });
      }
    });
  });
});

// --- (b) The notify toggle follows the Webex channel -------------------------------
test('per-idea notify toggle follows the Webex channel: shown when Webex on (mail off), hidden when both off', async ({
  browser,
}) => {
  const unique = Date.now();
  const title = `E2E Webex Notify Idea ${unique}`;
  const description =
    'This idea exercises the channel-agnostic per-idea notify toggle driven by the Webex channel.';
  const benefits = 'Proves the notify toggle shows when only Webex is enabled and hides when both are off.';

  const userContext = await roleContext(browser, 'user');
  const adminContext = await roleContext(browser, 'admin');
  const userPage = await userContext.newPage();

  try {
    await withFileLock(SETTINGS_LOCK, async () => {
      try {
        // Known starting point (idempotent across retries): BOTH channels OFF.
        await setMailEnabled(adminContext.request, false);
        await setWebexSettings(adminContext.request, { enabled: false, token: '' });

        // Create an own idea while BOTH channels are off — no send is attempted at
        // creation, and we avoid driving the create form while Webex is enabled.
        const idea = await createIdea(userContext.request, { title, description, benefits });
        const detailUrl = `/ideas/${idea.id}`;

        // --- (both off) submit form: NO toggle ---
        await userPage.goto('/submit');
        await expect(userPage.getByRole('button', { name: 'Submit Idea' })).toBeVisible();
        await expect(notifySwitch(userPage)).toHaveCount(0);

        // --- (both off) own idea detail: NO toggle ---
        await userPage.goto(detailUrl);
        await expect(userPage.locator('.v-card-title', { hasText: title })).toBeVisible();
        await expect(notifySwitch(userPage)).toHaveCount(0);

        // --- Admin enables Webex (mail stays off) ---
        await setWebexSettings(adminContext.request, {
          enabled: true,
          token: 'e2e-dummy-webex-token',
        });

        // --- (Webex on, mail off) submit form: the toggle appears ---
        await userPage.goto('/submit');
        await expect(notifySwitch(userPage)).toBeVisible();

        // --- (Webex on, mail off) own idea detail: the toggle appears for the submitter ---
        await userPage.goto(detailUrl);
        await expect(userPage.locator('.v-card-title', { hasText: title })).toBeVisible();
        await expect(notifySwitch(userPage)).toBeVisible();

        // --- Admin disables Webex → both off again ---
        await setWebexSettings(adminContext.request, { enabled: false, token: '' });

        // --- (both off) the toggle disappears on reload ---
        await userPage.reload();
        await expect(userPage.locator('.v-card-title', { hasText: title })).toBeVisible();
        await expect(notifySwitch(userPage)).toHaveCount(0);
      } finally {
        // Restore both channels to disabled even if an assertion above failed.
        await setMailEnabled(adminContext.request, false);
        await setWebexSettings(adminContext.request, { enabled: false, token: '' });
      }
    });
  } finally {
    await userContext.close();
    await adminContext.close();
  }
});
