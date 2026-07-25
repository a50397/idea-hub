import { test, expect, loginViaUi, logoutViaUi, drawer } from './support/test-fixtures';
import { CREDENTIALS } from './support/config';

test('local login: seeded admin signs in, sees their identity, and logs out', async ({ page }) => {
  const { email, password, name } = CREDENTIALS.admin;

  await loginViaUi(page, email, password);

  // Drawer shows the authenticated user's name + email.
  await expect(drawer(page).getByText(name, { exact: true })).toBeVisible();
  await expect(drawer(page).getByText(email, { exact: true })).toBeVisible();

  // Local accounts get a working logout button (SSO accounts do not).
  const logout = page.getByRole('button', { name: 'Logout' });
  await expect(logout).toBeVisible();

  await logoutViaUi(page);

  // Back on the login page.
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Sign in with SSO' })).toBeVisible();
});
