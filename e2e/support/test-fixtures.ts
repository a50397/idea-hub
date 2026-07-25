import { test as base, expect, type Page } from '@playwright/test';

/**
 * Per-test client IP via X-Forwarded-For.
 *
 * The backend runs with `trust proxy: 1` and applies per-IP rate limiters
 * (general /api = 100/15min, plus login and SSO limiters). Every browser test
 * hits the API from 127.0.0.1, so without isolation the whole suite would share
 * one bucket and exhaust it (especially with retries). Giving each test context
 * a distinct forwarded IP puts each test in its own bucket. This is test-only
 * infrastructure; no application code is changed.
 */
function randomForwardedFor(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.setExtraHTTPHeaders({ 'X-Forwarded-For': randomForwardedFor() });
    await use(context);
  },
});

export { expect };

/**
 * Open the local-login form. SSO is enabled in E2E, so the login page shows the
 * "Sign in with SSO" button first and hides the local form behind a toggle.
 */
export async function openLocalLoginForm(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in with SSO' }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Use a local account' }).click();
  await expect(page.locator('input[type="email"]')).toBeVisible();
}

/** Log in through the real UI as a local (seeded) account and land on the dashboard. */
export async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
  await openLocalLoginForm(page);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

/** Click the drawer logout button and assert the app returns to /login. */
export async function logoutViaUi(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** The navigation drawer (holds the user identity, nav entries and logout). */
export function drawer(page: Page) {
  return page.locator('.v-navigation-drawer');
}

/**
 * A navigation entry by its visible label, scoped to the drawer so it never
 * collides with a page heading of the same text (e.g. "Dashboard"). Targets the
 * list-item root (not the inner title span) so clicks reliably trigger the
 * router-link navigation.
 */
export function navItem(page: Page, name: string) {
  return drawer(page).locator('.v-list-item', { hasText: name });
}
