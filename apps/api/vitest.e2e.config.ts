import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/** Tests fonctionnels : vraie app Nest + vraie base `resto_test` (voir test/test-env.ts). */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    setupFiles: ['test/test-env.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
