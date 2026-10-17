import type { Role } from '../auth/team.js';

export type Audience = 'staff' | 'customer';

export interface PublicUser {
  id: string;
  name: string;
  phone: string | null;
  phoneVerified: boolean;
  email: string | null;
  emailVerified: boolean;
  restricted: boolean;
}

export interface Membership {
  restaurantId: string;
  role: Role;
}

export interface MeResponse {
  user: PublicUser;
  mustChangePin: boolean;
  recoveryPending: { availableAt: string } | null;
  memberships?: Membership[];
}

export interface Session {
  accessToken: string;
  expiresIn: number;
  /** Seulement en mode natif (mobile) ; sur le web le refresh token reste dans un cookie httpOnly. */
  refreshToken?: string;
}

export interface AuthResult extends Session {
  user: PublicUser;
  mustChangePin?: boolean;
  recoveryCancelled?: boolean;
  recoveryCode?: string;
  isNew?: boolean;
  status?: 'completed';
}

export interface PendingRecovery {
  status: 'pending';
  availableAt: string;
}

export interface Restaurant {
  id: string;
  slug: string;
  name: string;
  city: string;
  address: string | null;
  isPublic: boolean;
}

export interface TeamMember {
  userId: string;
  name: string;
  phone: string | null;
  role: Role;
  mustChangePin: boolean;
  pinResettable: boolean;
  recoveryPendingUntil: string | null;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

/** Erreur renvoyée par l'API (ou réseau coupé : `status` vaut 0). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Clé i18n renvoyée par l'API, ex. `auth.invalidCredentials` */
    readonly messageKey: string,
    readonly issues: ValidationIssue[] = [],
    readonly retryAfter?: number,
    readonly data: Record<string, unknown> = {},
  ) {
    super(messageKey);
    this.name = 'ApiError';
  }

  get isNetwork() {
    return this.status === 0;
  }
  get isValidation() {
    return this.status === 400 && this.issues.length > 0;
  }
  get isUnauthorized() {
    return this.status === 401;
  }
}

export interface TokenStore {
  getRefreshToken(): string | undefined | Promise<string | undefined>;
  setRefreshToken(token: string | undefined): void | Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: string;
  audience: Audience;
  fetch?: typeof fetch;
  /** Mobile natif : le refresh token voyage dans le corps (sinon cookie httpOnly). */
  native?: { tokenStore: TokenStore; deviceId?: string };
  /** Appelé quand la session est perdue (refresh refusé). */
  onSessionLost?: () => void;
  /** En-têtes ajoutés à chaque requête (utile aux tests). */
  extraHeaders?: Record<string, string>;
}

type Json = Record<string, unknown>;

/**
 * Client de l'API d'un espace (`staff` ou `customer`). Garde le jeton d'accès en mémoire,
 * le renouvelle une seule fois en cas de 401 (les appels concurrents partagent le même
 * rafraîchissement) et traduit les réponses d'erreur en `ApiError`.
 */
export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const base = `${options.baseUrl.replace(/\/$/, '')}/auth/${options.audience}`;
  const native = options.native;
  let accessToken: string | undefined;
  let refreshing: Promise<string | undefined> | undefined;

  async function raw(url: string, init: { method: string; body?: unknown; token?: string }) {
    const headers: Record<string, string> = { ...options.extraHeaders };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    if (native) {
      headers['x-client'] = 'native';
      if (native.deviceId) headers['x-device-id'] = native.deviceId;
    }
    let response: Response;
    try {
      response = await doFetch(url, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        credentials: native ? 'omit' : 'include',
      });
    } catch {
      throw new ApiError(0, 'network.offline');
    }
    if (response.status === 204) return undefined;
    let data: Json = {};
    try {
      data = (await response.json()) as Json;
    } catch {
      // corps vide ou non JSON
    }
    if (!response.ok) {
      const issues = Array.isArray(data.issues) ? (data.issues as ValidationIssue[]) : [];
      const retryAfter =
        typeof data.retryAfter === 'number'
          ? data.retryAfter
          : Number(response.headers.get('Retry-After')) || undefined;
      throw new ApiError(
        response.status,
        typeof data.message === 'string' ? data.message : 'server.error',
        issues,
        retryAfter,
        data,
      );
    }
    return data;
  }

  async function storeSession(data: Json): Promise<void> {
    accessToken = data.accessToken as string;
    if (native && typeof data.refreshToken === 'string')
      await native.tokenStore.setRefreshToken(data.refreshToken);
  }

  /** Renouvelle le jeton d'accès. Un seul rafraîchissement à la fois. */
  function refresh(): Promise<string | undefined> {
    refreshing ??= (async () => {
      try {
        const body = native
          ? { refreshToken: await native.tokenStore.getRefreshToken() }
          : undefined;
        const data = (await raw(`${base}/refresh`, { method: 'POST', body })) as Json;
        await storeSession(data);
        return accessToken;
      } catch (error) {
        accessToken = undefined;
        if (error instanceof ApiError && error.isUnauthorized) options.onSessionLost?.();
        throw error;
      } finally {
        refreshing = undefined;
      }
    })();
    return refreshing;
  }

  /** Appel authentifié, avec un seul nouvel essai après rafraîchissement. */
  async function authed<T>(path: string, method: string, body?: unknown): Promise<T> {
    if (!accessToken) await refresh();
    try {
      return (await raw(`${base}${path}`, { method, body, token: accessToken })) as T;
    } catch (error) {
      if (!(error instanceof ApiError) || !error.isUnauthorized) throw error;
      await refresh();
      return (await raw(`${base}${path}`, { method, body, token: accessToken })) as T;
    }
  }

  /** Appel public ; si la réponse ouvre une session, le jeton est mémorisé. */
  async function open<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
    const data = (await raw(`${base}${path}`, { method, body })) as Json | undefined;
    if (data && typeof data.accessToken === 'string') await storeSession(data);
    return data as T;
  }

  /** Appel sur une ressource hors `/auth/:audience` (restaurants, équipe…). */
  async function resource<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const url = `${options.baseUrl.replace(/\/$/, '')}${path}`;
    if (!accessToken) await refresh();
    try {
      return (await raw(url, { method, body, token: accessToken })) as T;
    } catch (error) {
      if (!(error instanceof ApiError) || !error.isUnauthorized) throw error;
      await refresh();
      return (await raw(url, { method, body, token: accessToken })) as T;
    }
  }

  return {
    audience: options.audience,
    get accessToken() {
      return accessToken;
    },

    /** Reprend la session à l'ouverture de l'app (cookie ou refresh token natif). */
    async restore(): Promise<MeResponse | null> {
      try {
        await refresh();
        return await authed<MeResponse>('/me', 'GET');
      } catch (error) {
        if (error instanceof ApiError && error.isUnauthorized) return null;
        throw error;
      }
    },
    me: () => authed<MeResponse>('/me', 'GET'),
    logout: async (): Promise<void> => {
      const body = native ? { refreshToken: await native.tokenStore.getRefreshToken() } : undefined;
      try {
        await raw(`${base}/logout`, { method: 'POST', body });
      } finally {
        accessToken = undefined;
        if (native) await native.tokenStore.setRefreshToken(undefined);
      }
    },

    registerWithPhone: (input: unknown) => open<AuthResult>('/register', input),
    loginWithPhone: (input: unknown) => open<AuthResult>('/login', input),
    registerWithEmail: (input: unknown) => open<{ sent: true }>('/register-email', input),
    resendRegistrationCode: (input: unknown) =>
      open<{ sent: true }>('/register-email/resend', input),
    verifyRegistrationCode: (input: unknown) => open<AuthResult>('/register-email/verify', input),
    loginWithEmail: (input: unknown) => open<AuthResult>('/login-email', input),
    loginWithGoogle: (idToken: string) => open<AuthResult>('/google', { idToken }),

    recoverWithCode: (input: unknown) => open<AuthResult>('/recover/code', input),
    recoverWithQuestions: (input: unknown) =>
      open<AuthResult | PendingRecovery>('/recover/questions', input),
    completeRecovery: (input: unknown) => open<AuthResult>('/recover/complete', input),
    forgotByEmail: (input: unknown) => open<{ sent: true }>('/email/forgot', input),
    recoverWithEmail: (input: unknown) => open<AuthResult>('/recover/email', input),

    changePin: async (input: unknown) => {
      const data = await authed<Session>('/pin', 'POST', input);
      await storeSession(data as unknown as Json);
      return data;
    },
    cancelRecovery: () => authed<{ cancelled: number }>('/recover/cancel', 'POST'),
    regenerateRecoveryCode: (pin: string) =>
      authed<{ recoveryCode: string }>('/recovery-code', 'POST', { pin }),
    addEmail: (input: unknown) => authed<{ sent: true }>('/email/add', 'POST', input),
    confirmEmail: (input: unknown) => authed<{ user: PublicUser }>('/email/confirm', 'POST', input),
    addPhone: (input: unknown) => authed<{ user: PublicUser }>('/phone', 'POST', input),

    // ── Restaurants et équipe (espace personnel) ──
    createRestaurant: (input: unknown) => resource<Restaurant>('/restaurants', 'POST', input),
    myRestaurants: () => resource<{ role: Role; restaurant: Restaurant }[]>('/restaurants/mine'),
    team: (restaurantId: string) => resource<TeamMember[]>(`/restaurants/${restaurantId}/team`),
    addStaff: (restaurantId: string, input: unknown) =>
      resource<{ member: TeamMember; temporaryPin: string | null }>(
        `/restaurants/${restaurantId}/team`,
        'POST',
        input,
      ),
    changeStaffRole: (restaurantId: string, memberId: string, role: string) =>
      resource<TeamMember>(`/restaurants/${restaurantId}/team/${memberId}`, 'PATCH', { role }),
    resetStaffPin: (restaurantId: string, memberId: string) =>
      resource<{ temporaryPin: string }>(
        `/restaurants/${restaurantId}/team/${memberId}/reset-pin`,
        'POST',
      ),
    cancelStaffRecovery: (restaurantId: string, memberId: string) =>
      resource<{ cancelled: number }>(
        `/restaurants/${restaurantId}/team/${memberId}/cancel-recovery`,
        'POST',
      ),
    removeStaff: (restaurantId: string, memberId: string) =>
      resource<void>(`/restaurants/${restaurantId}/team/${memberId}`, 'DELETE'),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
