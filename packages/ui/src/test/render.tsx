import { ApiError, type ApiClient, type MeResponse, type PublicUser } from '@resto/shared';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { AuthProvider } from '../auth/auth-context';
import { I18nProvider, type Locale } from '../i18n';

export const user: PublicUser = {
  id: 'u1',
  name: 'Awa Mbarga',
  phone: '+237677123456',
  phoneVerified: false,
  email: null,
  emailVerified: false,
  restricted: false,
};

export const meResponse = (over: Partial<MeResponse> = {}): MeResponse => ({
  user,
  mustChangePin: false,
  recoveryPending: null,
  memberships: [],
  ...over,
});

/** Client API simulé : toutes les méthodes sont des `vi.fn()` configurables. */
export function fakeApi(over: Record<string, unknown> = {}) {
  const base = {
    audience: 'customer' as const,
    accessToken: 'tok',
    restore: vi.fn().mockResolvedValue(null),
    me: vi.fn().mockResolvedValue(meResponse()),
    logout: vi.fn().mockResolvedValue(undefined),
    registerWithPhone: vi.fn(),
    loginWithPhone: vi.fn(),
    registerWithEmail: vi.fn(),
    resendRegistrationCode: vi.fn(),
    verifyRegistrationCode: vi.fn(),
    loginWithEmail: vi.fn(),
    loginWithGoogle: vi.fn(),
    recoverWithCode: vi.fn(),
    recoverWithQuestions: vi.fn(),
    completeRecovery: vi.fn(),
    forgotByEmail: vi.fn(),
    recoverWithEmail: vi.fn(),
    changePin: vi.fn(),
    cancelRecovery: vi.fn(),
    regenerateRecoveryCode: vi.fn(),
    addEmail: vi.fn(),
    confirmEmail: vi.fn(),
    addPhone: vi.fn(),
  };
  return Object.assign(base, over) as typeof base & ApiClient;
}

export const session = { accessToken: 'a', expiresIn: 900 };

export function renderWithProviders(
  ui: ReactElement,
  { api = fakeApi(), locale = 'fr' as Locale } = {},
) {
  const events = userEvent.setup();
  const result = render(
    <I18nProvider locale={locale}>
      <AuthProvider api={api}>{ui}</AuthProvider>
    </I18nProvider>,
  );
  return { api, events, ...result };
}

export const apiError = (status: number, key: string) => new ApiError(status, key);
