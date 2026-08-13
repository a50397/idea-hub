import { test, expect, navItem } from './support/test-fixtures';
import { storageStatePath } from './support/config';

test.describe('as a regular USER', () => {
  test.use({ storageState: storageStatePath('user') });

  test('sees no Review Queue / Users / Jira Settings nav and is bounced from admin-only routes by the router guard', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

    await expect(navItem(page, 'Dashboard')).toBeVisible();
    await expect(navItem(page, 'Review Queue')).toHaveCount(0);
    await expect(navItem(page, 'Users')).toHaveCount(0);
    await expect(navItem(page, 'Jira Settings')).toHaveCount(0);

    // Direct navigation to an admin-only route bounces back to the dashboard.
    await page.goto('/users');
    await expect(page).toHaveURL(/:5173\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(navItem(page, 'Users')).toHaveCount(0);

    await page.goto('/jira-settings');
    await expect(page).toHaveURL(/:5173\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  });
});

test.describe('as a POWER_USER', () => {
  test.use({ storageState: storageStatePath('power') });

  test('sees Review Queue but no Jira Settings nav and is bounced from /jira-settings by the router guard', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

    // Power+ role, so the review queue IS visible — but Jira Settings stays
    // admin-only (JiraSettingsPage route meta.requiresAdmin), same as
    // Users/Departments/Mail/Webex settings.
    await expect(navItem(page, 'Review Queue')).toBeVisible();
    await expect(navItem(page, 'Jira Settings')).toHaveCount(0);

    await page.goto('/jira-settings');
    await expect(page).toHaveURL(/:5173\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  });

  // Idea reads are org-wide for every role: a basic USER sees other people's
  // ideas, not just their own. The storage state is John Doe; the seeded
  // "Automate Weekly Status Reports" was submitted by Bob Johnson.
  test('sees another user\'s approved idea and can open its detail', async ({ page }) => {
    await page.goto('/approved');
    await expect(page.getByRole('heading', { level: 1, name: 'Approved Ideas' })).toBeVisible();

    const otherIdea = page.locator('.v-card', { hasText: 'Automate Weekly Status Reports' });
    await expect(otherIdea).toBeVisible();
    await expect(otherIdea).toContainText('Bob Johnson');

    await otherIdea.getByRole('button', { name: 'View Details' }).click();
    await expect(page).toHaveURL(/\/ideas\/[a-f0-9]+$/);
    await expect(
      page.locator('.v-card-title', { hasText: 'Automate Weekly Status Reports' })
    ).toBeVisible();
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

  test('sees the Jira Settings nav and can open it', async ({ page }) => {
    await page.goto('/');
    await expect(navItem(page, 'Jira Settings')).toBeVisible();

    await navItem(page, 'Jira Settings').click();
    await expect(page).toHaveURL(/\/jira-settings$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Jira Settings' })).toBeVisible();
  });
});
