import { test as setup, expect } from '@playwright/test';
import { API_BASE, CREDENTIALS, storageStatePath, type RoleKey } from './config';

/**
 * Log each seeded role in once via the API and persist its session cookie as a
 * Playwright storage state, so specs that only need "a logged-in <role>" can
 * restore it instead of driving the login UI every time. Runs as the `setup`
 * project that the `chromium` project depends on.
 */
async function authenticate(
  request: Parameters<Parameters<typeof setup>[1]>[0]['request'],
  role: RoleKey
): Promise<void> {
  const { email, password } = CREDENTIALS[role];
  const res = await request.post(`${API_BASE}/auth/login`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-Forwarded-For': '10.0.0.1' },
    data: { email, password },
  });
  expect(res.ok(), `API login failed for ${email}: ${res.status()} ${await res.text()}`).toBeTruthy();
  await request.storageState({ path: storageStatePath(role) });
}

setup('authenticate as user', async ({ request }) => {
  await authenticate(request, 'user');
});

setup('authenticate as power user', async ({ request }) => {
  await authenticate(request, 'power');
});

setup('authenticate as admin', async ({ request }) => {
  await authenticate(request, 'admin');
});
