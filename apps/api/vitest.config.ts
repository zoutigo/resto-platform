import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC (et non esbuild) : Nest repose sur les décorateurs et leurs métadonnées d'émission.
const plugins = [swc.vite({ module: { type: 'es6' } })];

/** Tests unitaires : sans base ni Redis, tout est mocké. */
export default defineConfig({
  plugins,
  test: {
    include: ['src/**/*.spec.ts'],
    setupFiles: ['test/unit-env.ts'],
  },
});
