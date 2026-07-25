import { test, expect, navItem } from './support/test-fixtures';
import { storageStatePath } from './support/config';

test.use({ storageState: storageStatePath('user') });

test('i18n: switching to Slovak translates nav labels and persists across reload', async ({
  page,
}) => {
  await page.goto('/');
  await expect(navItem(page, 'Dashboard')).toBeVisible();

  // Toggle SK.
  await page.getByRole('button', { name: 'SK', exact: true }).click();
  await expect(navItem(page, 'Prehľad')).toBeVisible();
  await expect(navItem(page, 'Dashboard')).toHaveCount(0);

  // Persists across a full reload (stored in localStorage).
  await page.reload();
  await expect(navItem(page, 'Prehľad')).toBeVisible();
  await expect(navItem(page, 'Dashboard')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('locale'))).toBe('sk');
});
