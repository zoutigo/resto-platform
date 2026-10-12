import { defineConfig, devices } from '@playwright/test';

/**
 * Tests fonctionnels : vrai navigateur + vrai serveur Next.
 * Port dédié (dev + 10) pour ne pas perturber le serveur de dev.
 */
const PORT = 3010;
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Les tests sont indépendants : le découpage en shards se fait par test.
  fullyParallel: true,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: BASE, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  // Mobile d'abord (Android d'entrée de gamme), puis desktop.
  projects: [
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'], channel: process.env.PW_CHANNEL ?? 'chrome' },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL ?? 'chrome' },
    },
  ],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: BASE,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: { NEXT_DIST_DIR: '.next-e2e' },
  },
});
