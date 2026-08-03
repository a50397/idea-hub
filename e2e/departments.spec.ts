import { test, expect } from './support/test-fixtures';
import { storageStatePath } from './support/config';
import type { Page } from '@playwright/test';

/**
 * Admin department management through the real UI: create + rename, reorder
 * (which drives the submit form's default department), and a blocked delete of a
 * referenced department. Uses the seeded admin storage state.
 *
 * These three tests run SERIAL. They all mutate the single shared department
 * set, and the reorder endpoint requires the request body to carry an exact
 * permutation of every current department id — so a create landing from a
 * sibling test mid-reorder would be rejected (400). departments.spec.ts is the
 * only spec that touches the department set, so serialising just these three
 * removes that race entirely while the file still runs in parallel with the
 * rest of the suite. Unique, timestamped names keep each attempt (and any
 * retry) independent; Všeobecné / Marketing are never renamed or reordered
 * except the blocked-delete attempt below, which changes nothing.
 */
test.use({ storageState: storageStatePath('admin') });
test.describe.configure({ mode: 'serial' });

const GENERAL = 'Všeobecné';

const deptRow = (page: Page, name: string) => page.locator('tr', { hasText: name });
const dialog = (page: Page, heading: string) =>
  page.locator('.v-overlay__content', { hasText: heading });

async function gotoDepartments(page: Page): Promise<void> {
  await page.goto('/departments');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Department Management' })
  ).toBeVisible();
}

async function createDepartment(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Create Department' }).click();
  const d = dialog(page, 'Create Department');
  await d.locator('.v-input', { hasText: 'Name' }).locator('input').fill(name);
  await d.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(d).toBeHidden();
}

/** 0-based index of the department's row among the data rows (-1 if absent). */
async function rowIndexOf(page: Page, name: string): Promise<number> {
  const rows = await page.locator('tbody tr').allTextContents();
  return rows.findIndex((text) => text.includes(name));
}

test('admin creates and renames a department', async ({ page }) => {
  const ts = Date.now();
  const original = `E2E-create-${ts}`;
  const renamed = `E2E-renamed-${ts}`;

  await gotoDepartments(page);

  // Create → the new row shows an Ideas count of 0 (3rd column: Order/Name/Ideas).
  await createDepartment(page, original);
  const row = deptRow(page, original);
  await expect(row).toBeVisible();
  await expect(row.locator('td').nth(2)).toHaveText('0');

  // Rename via the row's (icon-only) pencil → Edit Department dialog.
  await row.locator('button:has(.mdi-pencil)').click();
  const d = dialog(page, 'Edit Department');
  await expect(d).toBeVisible();
  await d.locator('.v-input', { hasText: 'Name' }).locator('input').fill(renamed);
  await d.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(d).toBeHidden();

  // New name shown, old name gone. The renamed dept is left in place (harmless).
  await expect(deptRow(page, renamed)).toBeVisible();
  await expect(deptRow(page, original)).toHaveCount(0);
});

test('reordering departments changes the submit-form default', async ({ page }) => {
  const dept = `E2E-reorder-${Date.now()}`;

  await gotoDepartments(page);

  // Newly created departments are appended last.
  await createDepartment(page, dept);
  await expect(deptRow(page, dept)).toBeVisible();

  // Move it up until it is the first row; each click waits for the row to rise
  // before the next (the reorder round-trip disables the buttons while in flight).
  let idx = await rowIndexOf(page, dept);
  expect(idx).toBeGreaterThan(0);
  while (idx > 0) {
    await deptRow(page, dept).getByRole('button', { name: 'Move up' }).click();
    await expect.poll(() => rowIndexOf(page, dept)).toBeLessThan(idx);
    idx = await rowIndexOf(page, dept);
  }
  await expect(page.locator('tbody tr').first()).toContainText(dept);

  // The submit form's Department default follows first-by-order → our dept.
  await page.goto('/submit');
  await expect(page.locator('.v-input', { hasText: 'Department' })).toContainText(dept);

  // Clean up: delete it (unreferenced, not last) → default reverts to Všeobecné.
  // Doubles as delete-success coverage.
  await gotoDepartments(page);
  await deptRow(page, dept).locator('button:has(.mdi-delete)').click();
  const del = dialog(page, 'Delete Department');
  await del.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(deptRow(page, dept)).toHaveCount(0);
});

test('admin sets a department notification email and it persists', async ({ page }) => {
  const ts = Date.now();
  const name = `E2E-notify-${ts}`;
  const email = `ops-${ts}@corp.example`;

  await gotoDepartments(page);

  // Fresh, unreferenced department so this test never collides with the others.
  await createDepartment(page, name);
  await expect(deptRow(page, name)).toBeVisible();

  // Open the Edit dialog (same pencil) and add one notification address to the
  // combobox (type + Enter commits a chip), then save.
  await deptRow(page, name).locator('button:has(.mdi-pencil)').click();
  const d = dialog(page, 'Edit Department');
  await expect(d).toBeVisible();
  const combo = d.locator('.v-input', { hasText: 'Notification Emails' });
  const comboInput = combo.locator('input');
  // Real keystrokes (not fill) so Vuetify's combobox tracks the pending text and
  // Enter commits it as a chip.
  await comboInput.click();
  await comboInput.pressSequentially(email);
  await comboInput.press('Enter');
  await expect(combo.getByText(email)).toBeVisible();
  await d.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(d).toBeHidden();

  // The notifications indicator column (4th: Order/Name/Ideas/Notifications) now
  // shows a count of 1.
  await expect(deptRow(page, name).locator('td').nth(3)).toContainText('1');

  // Reopen the Edit dialog → the address persisted and renders as a chip.
  await deptRow(page, name).locator('button:has(.mdi-pencil)').click();
  const reopened = dialog(page, 'Edit Department');
  await expect(reopened).toBeVisible();
  await expect(reopened.getByText(email)).toBeVisible();
});

test('admin sets a department Webex space (room ID) manually and it persists', async ({ page }) => {
  const ts = Date.now();
  const name = `E2E-webexroom-${ts}`;
  const roomId = `Y2lzY29zcGFyazovL3VzL1JPT00-${ts}`;

  await gotoDepartments(page);

  // Fresh, unreferenced department so this test never collides with the others.
  await createDepartment(page, name);
  await expect(deptRow(page, name)).toBeVisible();

  // Open Edit → the Webex-spaces combobox. The e2e backend black-holes the Webex
  // API (support/config.ts), so GET /webex-settings/rooms returns an empty list and
  // this exercises the MANUAL room-ID fallback (type + Enter commits a chip),
  // mirroring the notification-email flow above.
  await deptRow(page, name).locator('button:has(.mdi-pencil)').click();
  const d = dialog(page, 'Edit Department');
  await expect(d).toBeVisible();
  const combo = d.locator('.v-input', { hasText: 'Webex spaces' });
  const comboInput = combo.locator('input');
  await comboInput.click();
  await comboInput.pressSequentially(roomId);
  await comboInput.press('Enter');
  await expect(combo.getByText(roomId)).toBeVisible();
  await d.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(d).toBeHidden();

  // Reopen the Edit dialog → the room ID persisted and renders as a chip.
  await deptRow(page, name).locator('button:has(.mdi-pencil)').click();
  const reopened = dialog(page, 'Edit Department');
  await expect(reopened).toBeVisible();
  await expect(reopened.getByText(roomId)).toBeVisible();
});

test('deleting a referenced department is blocked', async ({ page }) => {
  await gotoDepartments(page);

  // Všeobecné is referenced by seeded ideas → the API returns 409 and the UI
  // surfaces the message in a snackbar; the dialog stays open on failure.
  await deptRow(page, GENERAL).locator('button:has(.mdi-delete)').click();
  const del = dialog(page, 'Delete Department');
  await del.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(
    page.getByText('Cannot delete a department that still has ideas')
  ).toBeVisible();

  // Dismiss the still-open dialog and confirm Všeobecné survived in the table.
  await del.getByRole('button', { name: 'Cancel' }).click();
  await expect(deptRow(page, GENERAL)).toBeVisible();
});
