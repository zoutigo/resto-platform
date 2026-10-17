import { test as base, expect } from '@playwright/test';
import { ApiHelper } from './api-helper';
import { API_URL, uniqueIp } from './data';

export * from './api-helper';
export * from './data';
export { expect };

/**
 * `test` enrichi : chaque test reçoit une IP unique (envoyée par le navigateur ET par les
 * assistants d'API) et un `api` pour préparer des données.
 */
export const test = base.extend<{ ip: string; api: ApiHelper }>({
  // eslint-disable-next-line no-empty-pattern
  ip: async ({}, use) => use(uniqueIp()),
  context: async ({ context, ip }, use) => {
    await context.setExtraHTTPHeaders({ 'X-Forwarded-For': ip });
    await use(context);
  },
  api: async ({ ip }, use) => use(new ApiHelper(API_URL, ip)),
});
