import { defineConfig } from '@playwright/test';

/**
 * Two projects:
 *  - "prod": the production build served by the game server (single origin, real WebSocket).
 *  - "dev":  the Vite dev server + game server exactly as `npm run dev` runs them
 *            (React StrictMode double-mounts effects here, which is how the original
 *            "player does not respond" bug escaped the prod-only suite).
 * By default the locally installed Google Chrome is used (no browser download);
 * PW_CHANNEL=msedge for Edge, PW_CHANNEL=bundled for Playwright's Chromium.
 */
const PROD_PORT = Number(process.env.E2E_PORT ?? 8790);
const DEV_CLIENT_PORT = 5180;
const DEV_SERVER_PORT = 8795;
const channel = process.env.PW_CHANNEL === 'bundled' ? undefined : (process.env.PW_CHANNEL ?? 'chrome');

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 150_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    channel,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'prod', use: { baseURL: `http://localhost:${PROD_PORT}` } },
    {
      name: 'dev',
      use: { baseURL: `http://localhost:${DEV_CLIENT_PORT}` },
      testMatch: ['controls.spec.ts', 'online.spec.ts', 'sprites.spec.ts', 'title.spec.ts'],
    },
  ],
  webServer: [
    {
      command: 'npm run build && node server/dist/index.js',
      url: `http://localhost:${PROD_PORT}/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      // VITE_E2E=true compiles the test hooks into this build (a plain release build has none).
      env: { PORT: String(PROD_PORT), SERVE_CLIENT: 'true', COUNTDOWN_MS: '800', ALLOWED_ORIGINS: `http://localhost:${PROD_PORT}`, VITE_E2E: 'true' },
    },
    {
      command: 'npm run dev',
      url: `http://localhost:${DEV_CLIENT_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { PORT: String(DEV_SERVER_PORT), CLIENT_PORT: String(DEV_CLIENT_PORT), COUNTDOWN_MS: '800', ALLOWED_ORIGINS: '*' },
    },
  ],
});
