import { test, expect } from './support/test-fixtures';
import { storageStatePath } from './support/config';

/**
 * Admin email settings through the real UI: save a configuration and prove it
 * persists across a reload, with the write-only password field staying empty and
 * showing the "no password saved" hint (never the "saved" hint) when no password
 * was set. Uses the seeded admin storage state.
 *
 * The config is saved DISABLED (host filled) so no send is ever attempted; this is
 * the only spec that touches the singleton mail-settings document, so it needs no
 * serialization and never collides with the other specs.
 */
test.use({ storageState: storageStatePath('admin') });

const hostInput = 'smtp.e2e.example';

test('admin saves email settings and they persist on reload', async ({ page }) => {
  await page.goto('/mail-settings');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Email Settings' })
  ).toBeVisible();

  // Fill the SMTP host, leaving mail disabled (default) so nothing is ever sent.
  const host = page.locator('.v-input', { hasText: 'SMTP host' }).locator('input');
  await host.fill(hostInput);

  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Email settings saved successfully!')).toBeVisible();

  // Reload: the saved host is reflected, and — since no password was set — the
  // write-only password field is empty and shows the "no password saved" hint.
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Email Settings' })
  ).toBeVisible();

  await expect(page.locator('.v-input', { hasText: 'SMTP host' }).locator('input')).toHaveValue(
    hostInput
  );

  const password = page.locator('.v-input', { hasText: 'Password' }).locator('input');
  await expect(password).toHaveValue('');
  await expect(page.getByText('No password saved')).toBeVisible();
  await expect(page.getByText('A password is saved')).toHaveCount(0);
});
