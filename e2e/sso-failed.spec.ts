import { test, expect } from './support/test-fixtures';

test('SSO failure: the error banner shows on /login?error=sso_failed', async ({ page }) => {
  await page.goto('/login?error=sso_failed');
  await expect(
    page.getByText('SSO sign-in failed. Please try again or use a local account.')
  ).toBeVisible();
});
