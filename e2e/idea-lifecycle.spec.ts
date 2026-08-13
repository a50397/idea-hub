import { test, expect, loginViaUi, logoutViaUi } from './support/test-fixtures';
import {
  API_BASE,
  CREDENTIALS,
  MOCK_JIRA_IDENTITY,
  MOCK_JIRA_PROJECT_KEY,
  MOCK_JIRA_URL,
  storageStatePath,
} from './support/config';
import { withFileLock, SETTINGS_LOCK } from './support/file-lock';
import type { APIRequestContext, Browser, BrowserContext } from '@playwright/test';

/**
 * Full idea lifecycle through the real UI, now that execution happens in Jira
 * instead of an in-app claim: USER submits (validation error first, then valid) →
 * POWER_USER approves in the Review Queue → POWER_USER dispatches it to Jira
 * ("Create Jira task") → the poller (support/mock-jira.mjs scripted via its
 * `__test__` control routes) mirrors status changes back onto the idea → a second
 * idea proves the cancel-resolution → back-to-Approved → re-dispatch loop.
 *
 * The old claim → assignee-steps → complete portion is DELIBERATELY NOT ported:
 * claiming no longer exists (PATCH /:id/claim was removed), and the grandfathered
 * steps/complete path for pre-existing IN_PROGRESS ideas is covered by the backend
 * integration tier (assignee-gated, never reachable by a Jira-dispatched idea,
 * which never gets an in-app assignee) — this spec must not attempt to claim.
 *
 * Mutates the global JiraSettings singleton (enable/disable), so — like
 * jira-settings.spec.ts — the whole flow runs under the SAME cross-worker lock the
 * three notification-settings specs share (support/file-lock.ts, "mail-settings").
 * The DB-stored baseUrl is a valid https placeholder (schema requires it); the
 * JIRA_API_BASE_URL env override (support/config.ts BACKEND_ENV) carries every
 * outbound call and the browse URL to the real mock at MOCK_JIRA_URL.
 */

const DEFAULT_CANCEL_RESOLUTIONS = "Won't Do,Cancelled,Duplicate";

/** A fresh browser context restored from the admin storage state, for settings-only API calls. */
async function adminApiContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ storageState: storageStatePath('admin') });
}

async function setJiraEnabled(request: APIRequestContext, enabled: boolean): Promise<void> {
  const res = await request.put(`${API_BASE}/jira-settings`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    data: {
      enabled,
      baseUrl: enabled ? 'https://mock-jira.example.com' : '',
      email: enabled ? MOCK_JIRA_IDENTITY.email : '',
      apiToken: enabled ? MOCK_JIRA_IDENTITY.apiToken : '',
      defaultProjectKey: enabled ? MOCK_JIRA_PROJECT_KEY : '',
      issueTypeName: 'Task',
      pollIntervalMinutes: 5,
      cancelResolutions: DEFAULT_CANCEL_RESOLUTIONS,
    },
  });
  expect(res.ok(), `jira-settings PUT failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function resetMockJira(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${MOCK_JIRA_URL}/__test__/reset`);
  expect(res.ok(), `mock-jira reset failed: ${res.status()}`).toBeTruthy();
}

/** Script the mock issue's status via support/mock-jira.mjs's control route. */
async function mockTransition(
  request: APIRequestContext,
  jiraIssueId: string,
  data: { statusName: string; categoryKey: 'new' | 'indeterminate' | 'done'; resolution?: string | null }
): Promise<void> {
  const res = await request.post(`${MOCK_JIRA_URL}/__test__/transition`, {
    data: { id: jiraIssueId, ...data },
  });
  expect(res.ok(), `mock-jira transition failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

/**
 * Poll GET /api/ideas/:id (real backend, real poller) until a predicate over the
 * full idea payload is true. Generic over `status` ALONE because that is not
 * always a meaningful signal: a freshly dispatched idea's `status` is already
 * `APPROVED` (it never entered `IN_PROGRESS`), so waiting on `status ===
 * 'APPROVED'` after a same-tick "new -> done (cancelled)" transition would be a
 * no-op that passes on the very first poll. `jiraSyncActive` flips to false ONLY
 * once a final state (done or cancelled) is actually reached, so it is the signal
 * that disambiguates "never left new" from "cancelled back to Approved".
 */
async function waitForIdeaCondition(
  request: APIRequestContext,
  ideaId: string,
  predicate: (idea: Record<string, unknown>) => boolean,
  description: string,
  timeoutMs = 15_000
): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await request.get(`${API_BASE}/ideas/${ideaId}`);
        if (!res.ok()) return false;
        return predicate(await res.json());
      },
      { timeout: timeoutMs, message: `waiting for idea ${ideaId}: ${description}` }
    )
    .toBe(true);
}

test('idea lifecycle: submit → approve → create Jira task → poller mirrors status → cancel + re-dispatch', async ({
  page,
  context,
  browser,
}) => {
  // A lot happens in one continuous flow (two full dispatch cycles, each with a
  // poller wait): give it more room than the suite default.
  test.setTimeout(120_000);

  const unique = Date.now();
  const title1 = `E2E Jira Lifecycle Idea ${unique}`;
  const title2 = `E2E Jira Cancel Idea ${unique}`;
  const description =
    'This is an end-to-end Jira lifecycle idea whose description is comfortably long enough to pass validation.';
  const benefits = 'Proves the full submit → approve → dispatch → poll → transition flow works through the UI.';

  const textField = (label: string) =>
    page.locator('.v-input', { hasText: label }).locator('input, textarea').first();
  const card = (title: string) => page.locator('.v-card', { hasText: title });
  const dialog = (heading: string) => page.locator('.v-overlay__content', { hasText: heading });

  async function submitIdea(title: string): Promise<void> {
    await page.goto('/submit');
    await textField('Title').fill(title);
    await textField('Description').fill(description);
    await textField('Benefits').fill(benefits);
    await page.locator('.v-input', { hasText: 'Estimated Effort' }).locator('.v-field').click();
    await page.getByRole('option', { name: '1-3 days' }).click();
    // Pin the department explicitly instead of trusting the preselected default:
    // the departments spec transiently reorders the first-by-order default.
    await page.locator('.v-input', { hasText: 'Department' }).locator('.v-field').click();
    await page.getByRole('option', { name: 'Všeobecné' }).click();
    await page.getByRole('button', { name: 'Submit Idea' }).click();
    await expect(page.getByText('Idea submitted successfully!')).toBeVisible();
  }

  async function approveIdea(title: string): Promise<void> {
    await page.goto('/review');
    await expect(card(title)).toBeVisible();
    await card(title).getByRole('button', { name: 'Approve' }).click();
    await dialog('Approve Idea').getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Idea approved successfully!')).toBeVisible();
  }

  /** Click "Create Jira task" on the (already-visible) Approved card and verify the new tab + chip. */
  async function dispatchIdea(
    title: string
  ): Promise<{ id: string; jiraIssueId: string; jiraIssueKey: string; jiraBrowseUrl: string }> {
    const [popup, response] = await Promise.all([
      context.waitForEvent('page'),
      page.waitForResponse((res) => res.url().includes('/jira-task') && res.request().method() === 'POST'),
      card(title).getByRole('button', { name: 'Create Jira task' }).click(),
    ]);
    const body = await response.json();
    expect(body.jiraBrowseUrl, `dispatch response missing jiraBrowseUrl: ${JSON.stringify(body)}`).toBeTruthy();

    // The new tab really navigated to the server-built browse URL (env-override
    // base — http is allowed there per the F7 protocol rule).
    await popup.waitForURL((url) => url.toString() === body.jiraBrowseUrl);
    await popup.close();

    // The button is replaced by a passive "Jira: KEY" chip.
    await expect(card(title).getByText(`Jira: ${body.jiraIssueKey}`)).toBeVisible();

    return { id: body.id, jiraIssueId: body.jiraIssueId, jiraIssueKey: body.jiraIssueKey, jiraBrowseUrl: body.jiraBrowseUrl };
  }

  const adminCtx = await adminApiContext(browser);
  try {
    await withFileLock(SETTINGS_LOCK, async () => {
      // Ideas this run dispatches to Jira, so the finally below can best-effort
      // delete them (see the cleanup comment there).
      const createdIdeaIds: string[] = [];
      try {
        await resetMockJira(adminCtx.request);
        await setJiraEnabled(adminCtx.request, true);

        // --- USER submits idea1 ---
        await loginViaUi(page, CREDENTIALS.user.email, CREDENTIALS.user.password);
        await page.goto('/submit');

        // Empty form → client-side validation error.
        await page.getByRole('button', { name: 'Submit Idea' }).click();
        await expect(page.getByText('Title must be at least 5 characters')).toBeVisible();

        await submitIdea(title1);

        // Appears in My Ideas as SUBMITTED.
        await page.goto('/my-ideas');
        await expect(card(title1)).toBeVisible();
        await expect(card(title1).getByText('Submitted', { exact: true })).toBeVisible();
        await logoutViaUi(page);

        // --- POWER_USER approves, then dispatches it to Jira ---
        await loginViaUi(page, CREDENTIALS.power.email, CREDENTIALS.power.password);
        await approveIdea(title1);

        // The idea STAYS Approved (with the passive chip) until Jira work starts —
        // the create button is gone, replaced by the chip, and no claim/assignee
        // step exists anymore.
        await page.goto('/approved');
        await expect(card(title1)).toBeVisible();
        const dispatch1 = await dispatchIdea(title1);
        createdIdeaIds.push(dispatch1.id);

        // --- Jira moves the issue to an indeterminate status (work starts) ---
        await mockTransition(page.request, dispatch1.jiraIssueId, {
          statusName: 'In Review',
          categoryKey: 'indeterminate',
        });
        await waitForIdeaCondition(
          page.request,
          dispatch1.id,
          (idea) => idea.status === 'IN_PROGRESS',
          'status becomes IN_PROGRESS'
        );

        await page.goto(`/ideas/${dispatch1.id}`);
        await expect(page.locator('.v-card-title', { hasText: title1 })).toBeVisible();
        // Canonical status chip (category-driven) and the raw Jira status chip.
        await expect(page.locator('.v-chip', { hasText: 'In Progress' })).toBeVisible();
        const jiraStatusRow = page.locator('.v-list-item', { hasText: 'Jira status' });
        await expect(jiraStatusRow.locator('.v-chip')).toHaveText('In Review');
        // Timeline: the human-dispatched event and the poller-mirrored one, the
        // latter with NO logged-in actor (byUserId null renders as "Jira").
        const timeline = page.locator('.v-timeline');
        await expect(timeline).toContainText('Jira task created');
        await expect(timeline).toContainText('Jira status changed');
        await expect(timeline).toContainText('by Jira');

        // --- Jira resolves the issue successfully (a non-cancel resolution) ---
        await mockTransition(page.request, dispatch1.jiraIssueId, {
          statusName: 'Resolved',
          categoryKey: 'done',
          resolution: 'Fixed',
        });
        await waitForIdeaCondition(page.request, dispatch1.id, (idea) => idea.status === 'DONE', 'status becomes DONE');

        await page.reload();
        await expect(page.locator('.v-chip', { hasText: 'Done' })).toBeVisible();
        await expect(jiraStatusRow.locator('.v-chip')).toHaveText('Resolved');
        const jiraResolutionRow = page.locator('.v-list-item', { hasText: 'Jira resolution' });
        await expect(jiraResolutionRow).toContainText('Fixed');

        // --- A second idea: dispatched, then Jira cancels it (a cancel-list
        // resolution) → back to Approved, and re-dispatch is allowed ---
        await submitIdea(title2);
        await approveIdea(title2);

        await page.goto('/approved');
        await expect(card(title2)).toBeVisible();
        const dispatch2 = await dispatchIdea(title2);
        createdIdeaIds.push(dispatch2.id);

        await mockTransition(page.request, dispatch2.jiraIssueId, {
          statusName: 'Cancelled',
          categoryKey: 'done',
          resolution: "Won't Do",
        });
        // `status === 'APPROVED'` alone would be a no-op here: this idea never left
        // APPROVED (it was never IN_PROGRESS), so that alone is already true at
        // dispatch time. `jiraSyncActive` only flips to false once the poller
        // actually reaches a final state, which is what proves the cancellation
        // (not just the dispatch) was processed.
        await waitForIdeaCondition(
          page.request,
          dispatch2.id,
          (idea) => idea.status === 'APPROVED' && idea.jiraSyncActive === false,
          'cancelled back to Approved (sync inactive)'
        );

        await page.goto(`/ideas/${dispatch2.id}`);
        await expect(page.locator('.v-timeline')).toContainText('Jira task cancelled');

        // Re-dispatch: the button reappears (chip → button again) and a NEW issue
        // is created.
        await page.goto('/approved');
        await expect(card(title2)).toBeVisible();
        await expect(card(title2).getByRole('button', { name: 'Create Jira task' })).toBeVisible();
        // Re-dispatch re-uses the SAME idea id (only its Jira mapping fields
        // change), so it is already covered by the dispatch2.id push above.
        const redispatch2 = await dispatchIdea(title2);
        expect(redispatch2.jiraIssueKey).not.toBe(dispatch2.jiraIssueKey);
      } finally {
        // Best-effort: without this, both ideas stay in the shared DB with
        // jiraSyncActive: true pointing at mock issues resetMockJira() below is
        // about to erase — background 404-cancel poller noise for any later
        // Jira-enabled window. Deleting is wrapped per-idea so a cleanup failure
        // (e.g. an id already gone) can never mask the real test outcome.
        for (const id of createdIdeaIds) {
          try {
            await adminCtx.request.delete(`${API_BASE}/ideas/${id}`, {
              headers: { 'X-Requested-With': 'XMLHttpRequest' },
            });
          } catch {
            // best-effort cleanup only
          }
        }
        // Restore: Jira disabled for other specs, mock state cleared.
        await setJiraEnabled(adminCtx.request, false);
        await resetMockJira(adminCtx.request);
      }
    });
  } finally {
    await adminCtx.close();
  }
});
