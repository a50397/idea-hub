import { test, expect, navItem } from './support/test-fixtures';
import { storageStatePath } from './support/config';

test.describe('as a regular USER', () => {
  test.use({ storageState: storageStatePath('user') });

  test('sees no Review Queue / Users nav and is bounced from /users by the router guard', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

    await expect(navItem(page, 'Dashboard')).toBeVisible();
    await expect(navItem(page, 'Review Queue')).toHaveCount(0);
    await expect(navItem(page, 'Users')).toHaveCount(0);

    // Direct navigation to an admin-only route bounces back to the dashboard.
    await page.goto('/users');
    await expect(page).toHaveURL(/:5173\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(navItem(page, 'Users')).toHaveCount(0);
  });
});

test.describe('as an ADMIN', () => {
  test.use({ storageState: storageStatePath('admin') });

  test('sees both Review Queue and Users nav and can open Users', async ({ page }) => {
    await page.goto('/');
    await expect(navItem(page, 'Review Queue')).toBeVisible();
    await expect(navItem(page, 'Users')).toBeVisible();

    await navItem(page, 'Users').click();
    await expect(page).toHaveURL(/\/users$/);
    await expect(page.getByRole('heading', { level: 1, name: 'User Management' })).toBeVisible();
  });
});
