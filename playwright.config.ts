import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

// Set once in the main process; workers and global setup inherit them via env.
// Throwaway DB + a password generated per run (test value only, never a real credential).
process.env.E2E_DATABASE_PATH ??= path.join(tmpdir(), `crm-e2e-${process.pid}.sqlite`);
process.env.E2E_ADMIN_EMAIL ??= 'e2e-admin@agency.test';
process.env.E2E_ADMIN_PASSWORD ??= `E2e-${randomBytes(12).toString('base64url')}`;

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  workers: 1, // tests share one DB and build on each other's users
  reporter: 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
    },
  ],
  // Runs the production build (API serving the built SPA) against a throwaway DB.
  // `pnpm test:e2e` builds first; global setup migrates and creates the admin.
  webServer: {
    command: 'node apps/api/dist/server.js',
    url: `http://127.0.0.1:${PORT}/api/v1/health`,
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(PORT),
      DATABASE_PATH: process.env.E2E_DATABASE_PATH,
      LOG_LEVEL: 'warn',
    },
  },
});
