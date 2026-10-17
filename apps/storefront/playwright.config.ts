import { createPlaywrightConfig } from '@resto/e2e-support/config';

// Port dédié (dev + 10) : ne perturbe pas `next dev` ; voir packages/e2e-support.
export default createPlaywrightConfig({ port: 3011 });
