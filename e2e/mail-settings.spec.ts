import { test, expect } from './support/test-fixtures';
import { API_BASE, storageStatePath } from './support/config';
import { withFileLock } from './support/file-lock';

/**
 * Admin email settings through the real UI: save a configuration and prove it
 * persists across a reload, with the write-only password field staying empty and
 * showing the "no password saved" hint (never the "saved" hint) when no password
 * was set. Uses the seeded admin storage state.
 *
 * The config is saved DISABLED (host filled) so no send is ever attempted. This
 * spec and notifications.spec.ts are the two that mutate the singleton
 * mail-settings document, so both hold the same cross-worker lock (support/
 * file-lock.ts) around their critical section: notifications.spec.ts is the only
 * spec that enables mail, and this save (always DISABLED) must not run while it
 * has mail on. The lock keeps the file running in parallel with the rest of the
 * suite while making just these two mutually exclusive.
 */
test.use({ storageState: storageStatePath('admin') });

const hostInput = 'smtp.e2e.example';

test('admin saves email settings and they persist on reload', async ({ page }) => {
  await withFileLock('mail-settings', async () => {
    // Self-enforced isolation: this spec asserts the SAVED-DISABLED state (and its
    // "no password saved" hint) persists, so it must start from mail DISABLED with no
    // stored password regardless of what another spec left in the singleton settings
    // doc. Set that known starting point explicitly through the admin API (page.request
    // carries the admin session; state-changing → needs the X-Requested-With CSRF
    // header, like notifications.spec.ts) instead of trusting ambient DB state.
    const reset = await page.request.put(`${API_BASE}/mail-settings`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      data: {
        enabled: false,
        host: '',
        port: 587,
        secure: false,
        username: '',
        from: 'IdeaHub <no-reply@ideahub.local>',
        language: 'en',
        subjectTemplate: '',
      },
    });
    expect(
      reset.ok(),
      `mail-settings reset PUT failed: ${reset.status()} ${await reset.text()}`
    ).toBeTruthy();

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
});
