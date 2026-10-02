import { defineConfig, devices } from '@playwright/test';

/**
 * Le parcours de bout en bout (Phase 9).
 *
 * Deux serveurs : l'API du parcours, qui refait le schema et sert le vrai
 * code sur une base de test, et l'application web, qui lui renvoie `/api`.
 * Playwright les demarre, les attend, et les arrete.
 *
 *   TEST_DATABASE_URL=postgresql://...mailfind_test npm run test:e2e
 */
const API_PORT = 3100;
const WEB_PORT = 5174;
const BASE = `http://localhost:${String(WEB_PORT)}`;

export default defineConfig({
  testDir: '.',
  // Un parcours complet traverse un import, une collecte et une verification :
  // la minute par defaut est trop courte sur une machine chargee.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // Un parcours qui passe une fois sur deux ne prouve rien : il echoue.
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],

  use: {
    baseURL: BASE,
    // De quoi comprendre un echec sans le rejouer.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command: 'npm run start:e2e --workspace backend',
      url: `http://localhost:${String(API_PORT)}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        E2E_PORT: String(API_PORT),
        APP_URL: BASE,
        API_URL: `http://localhost:${String(API_PORT)}`,
      },
    },
    {
      command: 'npm run dev --workspace frontend',
      url: BASE,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_PORT: String(WEB_PORT),
        VITE_BACKEND_URL: `http://localhost:${String(API_PORT)}`,
      },
    },
  ],
});
