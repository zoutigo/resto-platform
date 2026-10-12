import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // tsconfig est en jsx « preserve » (Next) : on force la transformation automatique pour les tests.
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.spec.{ts,tsx}'],
    css: false,
    // Les tests de formulaires saisissent du texte dans jsdom : marge pour les machines chargées.
    testTimeout: 30_000,
  },
});
