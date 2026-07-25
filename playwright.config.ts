import { defineConfig, devices } from '@playwright/test';
import {
  isCI,
  FRONTEND_URL,
  API_BASE,
  PORTS,
  BACKEND_ENV,
  MOCK_IDP_ENV,
} from './e2e/support/config';

/**
 * End-to-end suite for the IdeaHub monorepo.
 *
 * Servers (started by Playwright): a mock OIDC IdP, the Express backend (tsx)
 * with SSO pointed at that mock IdP, and the Vite dev server. `globalSetup`
 * wipes + pushes + seeds an isolated e2e database before any test runs.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: './e2e/test-results',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 1,
  workers: isCI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: './e2e/playwright-report', open: 'never' }],
  ],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: './e2e/support/global-setup.ts',

  use: {
    baseURL: FRONTEND_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /support[\\/]auth\.setup\.ts$/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],

  webServer: [
    {
      command: 'node e2e/support/mock-idp.mjs',
      port: PORTS.mockIdp,
      reuseExistingServer: !isCI,
      env: MOCK_IDP_ENV,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
    },
    {
      command: 'npx tsx src/index.ts',
      cwd: 'backend',
      port: PORTS.backend,
      reuseExistingServer: !isCI,
      env: BACKEND_ENV,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 120_000,
    },
    {
      command: `npx vite --port ${PORTS.frontend} --strictPort`,
      cwd: 'frontend',
      port: PORTS.frontend,
      reuseExistingServer: !isCI,
      env: { VITE_API_URL: API_BASE },
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 120_000,
    },
  ],
});
