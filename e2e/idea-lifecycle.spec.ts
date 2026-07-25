import { test, expect, loginViaUi, logoutViaUi } from './support/test-fixtures';
import { CREDENTIALS } from './support/config';

/**
 * Full idea lifecycle through the real UI, with status chips asserted at each
 * stage: USER submits (validation error first, then valid) → POWER_USER approves
 * in the Review Queue → USER claims from Approved → assignee adds a step and
 * completes. Uses a unique title so it never collides with seeded data.
 */
test('idea lifecycle: submit → approve → claim → complete, chips reflect each stage', async ({
  page,
}) => {
  const unique = Date.now();
  const title = `E2E Lifecycle Idea ${unique}`;
  const description =
    'This is an end-to-end lifecycle idea whose description is comfortably long enough to pass validation.';
  const benefits = 'Proves the full submit → approve → claim → complete flow works through the UI.';
  const stepText = `Implemented milestone ${unique}`;

  const textField = (label: string) =>
    page.locator('.v-input', { hasText: label }).locator('input, textarea').first();
  const card = (locator = page) => locator.locator('.v-card', { hasText: title });
  const dialog = (heading: string) => page.locator('.v-overlay__content', { hasText: heading });

  // --- USER submits ---
  await loginViaUi(page, CREDENTIALS.user.email, CREDENTIALS.user.password);
  await page.goto('/submit');

  // Empty form → client-side validation error.
  await page.getByRole('button', { name: 'Submit Idea' }).click();
  await expect(page.getByText('Title must be at least 5 characters')).toBeVisible();

  // Valid values.
  await textField('Title').fill(title);
  await textField('Description').fill(description);
  await textField('Benefits').fill(benefits);
  await page.locator('.v-input', { hasText: 'Estimated Effort' }).locator('.v-field').click();
  await page.getByRole('option', { name: '1-3 days' }).click();
  await page.getByRole('button', { name: 'Submit Idea' }).click();
  await expect(page.getByText('Idea submitted successfully!')).toBeVisible();

  // Appears in My Ideas as SUBMITTED.
  await page.goto('/my-ideas');
  await expect(card()).toBeVisible();
  await expect(card().getByText('Submitted', { exact: true })).toBeVisible();

  // --- POWER_USER approves in the Review Queue ---
  await logoutViaUi(page);
  await loginViaUi(page, CREDENTIALS.power.email, CREDENTIALS.power.password);
  await page.goto('/review');
  await expect(card()).toBeVisible();
  await card().getByRole('button', { name: 'Approve' }).click();
  await dialog('Approve Idea').getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Idea approved successfully!')).toBeVisible();

  // --- USER claims it from Approved (chip shows Approved first) ---
  await logoutViaUi(page);
  await loginViaUi(page, CREDENTIALS.user.email, CREDENTIALS.user.password);
  await page.goto('/approved');
  await expect(card()).toBeVisible();
  await expect(card().getByText('Approved', { exact: true })).toBeVisible();
  await card().getByRole('button', { name: 'Claim & Start' }).click();
  await expect(page.getByText('Idea claimed successfully!')).toBeVisible();

  // Now IN_PROGRESS in My Ideas.
  await page.goto('/my-ideas');
  await expect(card().getByText('In Progress', { exact: true })).toBeVisible();

  // --- Assignee adds a step and completes on the detail page ---
  await card().getByRole('button', { name: 'View Details' }).click();
  await expect(page).toHaveURL(/\/ideas\/[a-f0-9]+$/);
  await expect(page.locator('.v-card-title', { hasText: title })).toBeVisible();

  await page.getByPlaceholder('Describe what was done...').fill(stepText);
  await page.getByRole('button', { name: 'Add Step' }).click();
  await expect(page.getByText(stepText)).toBeVisible();

  await page.getByRole('button', { name: 'Mark Complete' }).click();
  await dialog('Complete Idea').getByRole('button', { name: 'Complete' }).click();
  await expect(page.getByText('Idea marked as completed!')).toBeVisible();

  // Detail status chip now DONE.
  await expect(page.locator('.v-chip', { hasText: 'Done' })).toBeVisible();
});
