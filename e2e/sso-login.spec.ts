import { test, expect, navItem, drawer } from './support/test-fixtures';
import { API_BASE, SSO_IDENTITY, storageStatePath } from './support/config';

/**
 * SSO round-trip against the mock IdP. The mock auto-approves authorize (no
 * login form), so this validates redirect mechanics plus role/department
 * mapping — not credential entry.
 */
test('SSO login: OIDC round-trip, identity + role/department mapping, and admin view', async ({
  page,
  browser,
}) => {
  // Unauthenticated → click the SSO button → full-page OIDC round-trip → dashboard.
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in with SSO' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

  // Drawer shows the mock identity.
  await expect(drawer(page).getByText(SSO_IDENTITY.name, { exact: true })).toBeVisible();
  await expect(drawer(page).getByText(SSO_IDENTITY.email, { exact: true })).toBeVisible();

  // Roles claim ['ideahub-power'] maps to POWER_USER → Review Queue nav visible.
  await expect(navItem(page, 'Review Queue')).toBeVisible();

  // SSO sessions are owned by the IdP: no logout button, no Change Password nav.
  await expect(page.getByRole('button', { name: 'Logout' })).toHaveCount(0);
  await expect(navItem(page, 'Change Password')).toHaveCount(0);

  // Role + department (org claim) mapping verified directly against the session.
  const me = await page.request.get(`${API_BASE}/auth/me`);
  expect(me.ok()).toBeTruthy();
  const body = await me.json();
  expect(body.authProvider).toBe('SSO');
  expect(body.role).toBe(SSO_IDENTITY.mappedRole);
  expect(body.department).toBe(SSO_IDENTITY.org);

  // Admin (fresh context) sees the SSO user with an SSO chip and a disabled edit.
  const adminContext = await browser.newContext({
    storageState: storageStatePath('admin'),
    extraHTTPHeaders: { 'X-Forwarded-For': '10.200.0.1' },
  });
  try {
    const adminPage = await adminContext.newPage();
    await adminPage.goto('/users');
    const row = adminPage.locator('tr', { hasText: SSO_IDENTITY.email });
    await expect(row).toBeVisible();
    await expect(row.getByText('SSO', { exact: true })).toBeVisible();
    await expect(row.locator('button:has(.mdi-pencil)')).toBeDisabled();
  } finally {
    await adminContext.close();
  }
});
