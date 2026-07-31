import { test, expect } from './support/test-fixtures';
import { API_BASE, FRONTEND_URL, storageStatePath, type RoleKey } from './support/config';
import { withFileLock } from './support/file-lock';
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';

/**
 * Per-idea lifecycle-notification opt-in through the real UI.
 *
 *   1. mail disabled (the suite default) ⇒ the create form shows NO toggle;
 *   2. an admin enables outbound mail (dummy SMTP host — nothing is ever sent);
 *   3. a USER creates an idea with the toggle ON, sees the switch ON on the detail
 *      page as submitter, flips it off, and the change survives a reload;
 *   4. a POWER_USER (not the submitter) sees NO switch on the same idea;
 *   5. mail is restored to disabled.
 *
 * Steps 2–5 run under a cross-worker lock (support/file-lock.ts) because this is
 * the only spec that ENABLES mail, and mail-settings.spec.ts — which always saves
 * DISABLED — must not flip it off mid-flow. The whole flow is one serial test so
 * the ordered, stateful steps never race each other; the mail state is set through
 * the admin API (fast, deterministic) so the locked window stays short.
 */

const NOTIFY_LABEL = 'Notify me about changes to this idea';

// The notify switch, located by its label so the SAME locator resolves to the
// switch on both screens despite their different markup: on the create form the
// label sits inside the .v-switch, while the detail sidebar renders a settings-style
// .v-list-item row with the label on the left and the switch in the append slot.
const notifySwitch = (page: Page) =>
  page
    .locator('.v-switch', { hasText: NOTIFY_LABEL })
    .or(page.locator('.v-list-item', { hasText: NOTIFY_LABEL }).locator('.v-switch'));
const notifyInput = (page: Page) => notifySwitch(page).locator('input');

// A distinct forwarded IP per context so each lands in its own rate-limit bucket
// (mirrors support/test-fixtures.ts, which the hand-rolled contexts here bypass).
function randomForwardedFor(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

// A browser context restored from a seeded role's storage state, with the same
// forwarded-IP isolation and EN-locale seeding the shared fixture applies (the app
// defaults to Slovak, and the assertions below are English).
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

// Enable/disable outbound mail via the admin API (state-changing → needs the CSRF
// header). `effectiveEnabled` is `enabled && host`, so a non-empty host is required
// when enabling; the host is a dummy that never receives a send in this flow.
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

test('per-idea notify toggle: hidden when mail off, submitter-only when mail on, persists', async ({
  browser,
}) => {
  const unique = Date.now();
  const title = `E2E Notify Idea ${unique}`;
  const description =
    'This idea exercises the per-idea lifecycle-notification opt-in end to end through the UI.';
  const benefits = 'Proves the notify toggle shows only for the submitter when mail is enabled.';

  const userContext = await roleContext(browser, 'user');
  const powerContext = await roleContext(browser, 'power');
  const adminContext = await roleContext(browser, 'admin');
  const userPage = await userContext.newPage();
  const powerPage = await powerContext.newPage();

  const textField = (page: Page, label: string) =>
    page.locator('.v-input', { hasText: label }).locator('input, textarea').first();
  const card = (page: Page) => page.locator('.v-card', { hasText: title });

  try {
    await withFileLock('mail-settings', async () => {
      try {
        // Known starting point (idempotent across retries): mail OFF.
        await setMailEnabled(adminContext.request, false);

        // --- (1) Mail disabled ⇒ no toggle on the create form ---
        await userPage.goto('/submit');
        await expect(userPage.getByRole('button', { name: 'Submit Idea' })).toBeVisible();
        await expect(notifySwitch(userPage)).toHaveCount(0);

        // --- (2) Admin enables outbound mail ---
        await setMailEnabled(adminContext.request, true);

        // --- (3) User creates an idea with the toggle ON ---
        await userPage.goto('/submit');
        await expect(notifySwitch(userPage)).toBeVisible(); // now that mail is on
        await textField(userPage, 'Title').fill(title);
        await textField(userPage, 'Description').fill(description);
        await textField(userPage, 'Benefits').fill(benefits);
        await userPage.locator('.v-input', { hasText: 'Estimated Effort' }).locator('.v-field').click();
        await userPage.getByRole('option', { name: '1-3 days' }).click();
        await userPage.locator('.v-input', { hasText: 'Department' }).locator('.v-field').click();
        await userPage.getByRole('option', { name: 'Všeobecné' }).click();
        // Turn the opt-in ON (default is OFF).
        await notifySwitch(userPage).click();
        await expect(notifyInput(userPage)).toBeChecked();
        await userPage.getByRole('button', { name: 'Submit Idea' }).click();
        await expect(userPage.getByText('Idea submitted successfully!')).toBeVisible();

        // Open the idea's detail page as its submitter.
        await userPage.goto('/my-ideas');
        await expect(card(userPage)).toBeVisible();
        await card(userPage).getByRole('button', { name: 'View Details' }).click();
        await expect(userPage).toHaveURL(/\/ideas\/[a-f0-9]+$/);
        const detailUrl = userPage.url();

        // As submitter with mail on, the switch is shown and reflects the ON opt-in.
        await expect(notifySwitch(userPage)).toBeVisible();
        await expect(notifyInput(userPage)).toBeChecked();

        // Flip it off; wait for the PATCH so the reload reads persisted state.
        await Promise.all([
          userPage.waitForResponse(
            (r) => r.url().includes('/notify') && r.request().method() === 'PATCH' && r.ok()
          ),
          notifySwitch(userPage).click(),
        ]);
        await expect(notifyInput(userPage)).not.toBeChecked();

        // Persistence: the off state survives a full reload.
        await userPage.reload();
        await expect(notifySwitch(userPage)).toBeVisible();
        await expect(notifyInput(userPage)).not.toBeChecked();

        // --- (4) A different role (power user) sees NO switch on the same idea ---
        await powerPage.goto(detailUrl);
        await expect(powerPage.locator('.v-card-title', { hasText: title })).toBeVisible();
        await expect(notifySwitch(powerPage)).toHaveCount(0);
      } finally {
        // --- (5) Restore mail to disabled (even if an assertion above failed) ---
        await setMailEnabled(adminContext.request, false);
      }
    });
  } finally {
    await userContext.close();
    await powerContext.close();
    await adminContext.close();
  }
});
