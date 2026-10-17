import type { ApiClient } from '@resto/shared';
import { AuthProvider, I18nProvider, type Locale } from '@resto/ui';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { vi } from 'vitest';

export const owner = {
  id: 'u1',
  name: 'Paul Essomba',
  phone: '+237699887766',
  phoneVerified: false,
  email: null,
  emailVerified: false,
  restricted: false,
};

export const restaurant = (id = 'r1', name = 'Chez Mama') => ({
  id,
  slug: id,
  name,
  city: 'Douala',
  address: null,
  isPublic: false,
});

/** Client API simulé, déjà « connecté » ; chaque méthode est surchargeable. */
export function fakeApi(over: Record<string, unknown> = {}) {
  const api = {
    audience: 'customer' as const,
    accessToken: 'tok',
    restore: vi.fn().mockResolvedValue(null),
    me: vi.fn().mockResolvedValue({
      user: owner,
      mustChangePin: false,
      recoveryPending: null,
      memberships: [],
    }),
    logout: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  return api as typeof api & ApiClient;
}

export function renderApp(ui: ReactElement, { api = fakeApi(), locale = 'fr' as Locale } = {}) {
  const events = userEvent.setup();
  const result = render(
    <I18nProvider locale={locale}>
      <AuthProvider api={api}>{ui}</AuthProvider>
    </I18nProvider>,
  );
  return { api, events, ...result };
}
