import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const src = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  plugins: [react()],
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: [
      // Auto-référence du paquet (les composants shadcn importent `@resto/ui/lib/utils`).
      { find: /^@resto\/ui\/(components|lib|hooks)\/(.*)$/, replacement: `${src}/$1/$2` },
    ],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.spec.{ts,tsx}'],
    css: false,
    testTimeout: 30_000,
  },
});
