import { defineConfig, devices } from '@playwright/test';
import { API_URL } from './data';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://resto:resto@localhost:5433/resto_test';
const API_PORT = new URL(API_URL).port || '4010';

interface Options {
  /** Port du site testé (port de dev + 10). */
  port: number;
  /** Dossier du site, relatif au répertoire d'où Playwright est lancé. */
  webOrigins?: string;
}

/**
 * Configuration commune des tests fonctionnels des deux sites :
 * vraie API Nest (NODE_ENV=test) + vraie base `resto_test` + site Next en build de production,
 * navigateur mobile (Pixel 5) puis desktop.
 */
export function createPlaywrightConfig({
  port,
  webOrigins = 'http://localhost:3010,http://localhost:3011',
}: Options) {
  const base = `http://localhost:${port}`;
  return defineConfig({
    testDir: './e2e',
    // Les tests sont indépendants (données uniques) : le découpage en shards se fait par test.
    fullyParallel: true,
    workers: 1,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    retries: process.env.CI ? 1 : 0,
    reporter: [['list'], ['html', { open: 'never' }]],
    use: { baseURL: base, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
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
    webServer: [
      {
        // Build + base remise à zéro + API réelle en mode test (emails lisibles, IP via X-Forwarded-For).
        command:
          'npm run build -w @resto/shared && npm run build && node scripts/reset-test-db-cli.mjs && node dist/main.js',
        cwd: '../api',
        url: `http://localhost:${API_PORT}/health`,
        timeout: 180_000,
        reuseExistingServer: !process.env.CI,
        env: {
          NODE_ENV: 'test',
          API_PORT,
          DATABASE_URL: TEST_DATABASE_URL,
          AUTH_JWT_SECRET: 'e2e-only-jwt-secret-0123456789abcdefghij',
          AUTH_PEPPER: 'e2e-only-pepper-0123456789abcdefghijklm',
          WEB_ORIGINS: webOrigins,
          TRUST_PROXY: '1',
        },
      },
      {
        command: `npx next build && npx next start --port ${port}`,
        url: base,
        timeout: 240_000,
        reuseExistingServer: !process.env.CI,
        env: {
          NEXT_DIST_DIR: '.next-e2e',
          NEXT_PUBLIC_API_URL: API_URL,
          NEXT_TELEMETRY_DISABLED: '1',
        },
      },
    ],
  });
}
