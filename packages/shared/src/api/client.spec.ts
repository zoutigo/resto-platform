import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './client.js';

type Call = { url: string; init: RequestInit & { headers: Record<string, string> } };

function jsonResponse(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

function setup(responses: (Response | Error | ((call: Call) => Response))[]) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchMock = vi.fn(async (url: string, init: Call['init']) => {
    const call = { url, init };
    calls.push(call);
    const next = queue.shift();
    if (!next) throw new Error(`Réponse non prévue pour ${init.method} ${url}`);
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(call) : next;
  });
  const onSessionLost = vi.fn();
  const client = createApiClient({
    baseUrl: 'http://api.test/',
    audience: 'staff',
    fetch: fetchMock as unknown as typeof fetch,
    onSessionLost,
  });
  return { client, calls, fetchMock, onSessionLost };
}

const user = {
  id: 'u1',
  name: 'Awa',
  phone: null,
  phoneVerified: false,
  email: null,
  emailVerified: false,
  restricted: false,
};

describe('appels publics', () => {
  it('cible /auth/<espace>/…, envoie du JSON avec les cookies et mémorise le jeton', async () => {
    const { client, calls } = setup([
      jsonResponse(200, { user, accessToken: 'tok1', expiresIn: 900 }),
    ]);
    const result = await client.loginWithPhone({ phone: '+237677123456', pin: '483920' });
    expect(result.accessToken).toBe('tok1');
    expect(client.accessToken).toBe('tok1');
    expect(calls[0]?.url).toBe('http://api.test/auth/staff/login');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.credentials).toBe('include');
    expect(calls[0]?.init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      phone: '+237677123456',
      pin: '483920',
    });
    expect(calls[0]?.init.headers.Authorization).toBeUndefined();
  });

  it('ne mémorise pas de jeton quand la réponse n’en contient pas', async () => {
    const { client } = setup([jsonResponse(202, { sent: true })]);
    await client.registerWithEmail({});
    expect(client.accessToken).toBeUndefined();
  });

  it('une récupération différée (202) renvoie le statut sans jeton', async () => {
    const { client } = setup([
      jsonResponse(202, { status: 'pending', availableAt: '2026-10-19T10:00:00.000Z' }),
    ]);
    const result = await client.recoverWithQuestions({});
    expect(result).toEqual({ status: 'pending', availableAt: '2026-10-19T10:00:00.000Z' });
    expect(client.accessToken).toBeUndefined();
  });
});

describe('erreurs', () => {
  it('traduit une 400 de validation en ApiError avec les champs', async () => {
    const issues = [{ path: 'pin', message: 'pin.weak' }];
    const { client } = setup([jsonResponse(400, { message: 'validation.failed', issues })]);
    const error = await client.loginWithPhone({}).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, messageKey: 'validation.failed', issues });
    expect(error.isValidation).toBe(true);
  });

  it('expose la clé i18n et le délai d’un 429', async () => {
    const { client } = setup([
      jsonResponse(
        429,
        { message: 'auth.tooManyAttempts', retryAfter: 42 },
        { 'Retry-After': '42' },
      ),
    ]);
    const error = await client.loginWithPhone({}).catch((e) => e);
    expect(error).toMatchObject({
      status: 429,
      messageKey: 'auth.tooManyAttempts',
      retryAfter: 42,
    });
  });

  it('lit Retry-After quand le corps ne le porte pas', async () => {
    const { client } = setup([jsonResponse(429, { message: 'x' }, { 'Retry-After': '7' })]);
    expect(await client.loginWithPhone({}).catch((e) => e)).toMatchObject({ retryAfter: 7 });
  });

  it('transforme une panne réseau en ApiError status 0', async () => {
    const { client } = setup([new TypeError('Failed to fetch')]);
    const error = await client.loginWithPhone({}).catch((e) => e);
    expect(error).toMatchObject({ status: 0, messageKey: 'network.offline' });
    expect(error.isNetwork).toBe(true);
  });

  it('gère une 500 sans corps JSON', async () => {
    const { client } = setup([new Response('<html>oups</html>', { status: 500 })]);
    expect(await client.loginWithPhone({}).catch((e) => e)).toMatchObject({
      status: 500,
      messageKey: 'server.error',
    });
  });

  it('conserve les données utiles de l’erreur (échéance d’une récupération)', async () => {
    const { client } = setup([
      jsonResponse(409, { message: 'recovery.notYetAvailable', availableAt: '2026-10-19' }),
    ]);
    const error = await client.completeRecovery({}).catch((e) => e);
    expect(error.data.availableAt).toBe('2026-10-19');
  });
});

describe('appels authentifiés', () => {
  it('rafraîchit d’abord (cookie), puis appelle avec le jeton', async () => {
    const { client, calls } = setup([
      jsonResponse(200, { accessToken: 'tok1', expiresIn: 900 }),
      jsonResponse(200, { user, mustChangePin: false, recoveryPending: null }),
    ]);
    const me = await client.me();
    expect(me.user.id).toBe('u1');
    expect(calls.map((c) => c.url)).toEqual([
      'http://api.test/auth/staff/refresh',
      'http://api.test/auth/staff/me',
    ]);
    expect(calls[1]?.init.headers.Authorization).toBe('Bearer tok1');
  });

  it('sur 401, rafraîchit une fois et rejoue la requête', async () => {
    const { client, calls } = setup([
      jsonResponse(200, { accessToken: 'old', expiresIn: 900 }),
      jsonResponse(401, { message: 'auth.invalidToken' }),
      jsonResponse(200, { accessToken: 'new', expiresIn: 900 }),
      jsonResponse(200, { user, mustChangePin: false, recoveryPending: null }),
    ]);
    await client.me();
    expect(calls).toHaveLength(4);
    expect(calls[3]?.init.headers.Authorization).toBe('Bearer new');
  });

  it('abandonne et prévient quand le refresh est refusé', async () => {
    const { client, onSessionLost } = setup([
      jsonResponse(401, { message: 'auth.invalidSession' }),
    ]);
    await expect(client.me()).rejects.toMatchObject({ status: 401 });
    expect(onSessionLost).toHaveBeenCalledOnce();
    expect(client.accessToken).toBeUndefined();
  });

  it('ne boucle pas : un second 401 après rafraîchissement est renvoyé', async () => {
    const { client, calls } = setup([
      jsonResponse(200, { accessToken: 'a', expiresIn: 900 }),
      jsonResponse(401, { message: 'x' }),
      jsonResponse(200, { accessToken: 'b', expiresIn: 900 }),
      jsonResponse(401, { message: 'x' }),
    ]);
    await expect(client.me()).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(4);
  });

  it('partage un seul rafraîchissement entre appels simultanés', async () => {
    const { client, calls } = setup([
      jsonResponse(200, { accessToken: 'tok', expiresIn: 900 }),
      jsonResponse(200, { user, mustChangePin: false, recoveryPending: null }),
      jsonResponse(200, []),
    ]);
    await Promise.all([client.me(), client.myRestaurants()]);
    expect(calls.filter((c) => c.url.endsWith('/refresh'))).toHaveLength(1);
  });

  it('ne rejoue pas sur une erreur autre que 401', async () => {
    const { client, calls } = setup([
      jsonResponse(200, { accessToken: 'tok', expiresIn: 900 }),
      jsonResponse(403, { message: 'restaurant.forbiddenRole' }),
    ]);
    await expect(client.team('r1')).rejects.toMatchObject({ status: 403 });
    expect(calls).toHaveLength(2);
  });
});

describe('restore', () => {
  it('renvoie le profil quand la session est valide', async () => {
    const { client } = setup([
      jsonResponse(200, { accessToken: 'tok', expiresIn: 900 }),
      jsonResponse(200, { user, mustChangePin: false, recoveryPending: null, memberships: [] }),
    ]);
    expect((await client.restore())?.user.id).toBe('u1');
  });

  it('renvoie null sans session (pas d’erreur)', async () => {
    const { client } = setup([jsonResponse(401, { message: 'auth.invalidSession' })]);
    expect(await client.restore()).toBeNull();
  });

  it('propage une panne réseau', async () => {
    const { client } = setup([new TypeError('offline')]);
    await expect(client.restore()).rejects.toMatchObject({ status: 0 });
  });
});

describe('ressources et déconnexion', () => {
  it('appelle les ressources hors /auth avec le bon verbe et gère le 204', async () => {
    const { client, calls } = setup([
      jsonResponse(200, { accessToken: 'tok', expiresIn: 900 }),
      jsonResponse(204),
      jsonResponse(200, { temporaryPin: '482915' }),
    ]);
    await client.removeStaff('r1', 'm1');
    const reset = await client.resetStaffPin('r1', 'm1');
    expect(reset.temporaryPin).toBe('482915');
    expect(calls[1]?.url).toBe('http://api.test/restaurants/r1/team/m1');
    expect(calls[1]?.init.method).toBe('DELETE');
    expect(calls[2]?.url).toBe('http://api.test/restaurants/r1/team/m1/reset-pin');
  });

  it('logout efface le jeton même si l’appel échoue', async () => {
    const { client } = setup([
      jsonResponse(200, { user, accessToken: 'tok', expiresIn: 900 }),
      new TypeError('offline'),
    ]);
    await client.loginWithPhone({});
    await expect(client.logout()).rejects.toMatchObject({ status: 0 });
    expect(client.accessToken).toBeUndefined();
  });

  it('changePin met à jour le jeton avec la nouvelle session', async () => {
    const { client } = setup([
      jsonResponse(200, { user, accessToken: 'first', expiresIn: 900 }),
      jsonResponse(200, { accessToken: 'second', expiresIn: 900 }),
    ]);
    await client.loginWithPhone({});
    await client.changePin({});
    expect(client.accessToken).toBe('second');
  });
});

describe('mode natif', () => {
  function nativeSetup(responses: Response[]) {
    const store = { token: 'stored-refresh' as string | undefined };
    const calls: Call[] = [];
    const queue = [...responses];
    const fetchMock = vi.fn(async (url: string, init: Call['init']) => {
      calls.push({ url, init });
      return queue.shift()!;
    });
    const client = createApiClient({
      baseUrl: 'http://api.test',
      audience: 'customer',
      fetch: fetchMock as unknown as typeof fetch,
      native: {
        deviceId: 'dev-1',
        tokenStore: {
          getRefreshToken: () => store.token,
          setRefreshToken: (t) => void (store.token = t),
        },
      },
    });
    return { client, store, calls };
  }

  it('envoie le refresh token dans le corps, sans cookie, et mémorise le nouveau', async () => {
    const { client, store, calls } = nativeSetup([
      jsonResponse(200, { accessToken: 'a', refreshToken: 'rotated', expiresIn: 900 }),
      jsonResponse(200, { user, mustChangePin: false, recoveryPending: null }),
    ]);
    await client.me();
    expect(calls[0]?.init.credentials).toBe('omit');
    expect(calls[0]?.init.headers['x-client']).toBe('native');
    expect(calls[0]?.init.headers['x-device-id']).toBe('dev-1');
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ refreshToken: 'stored-refresh' });
    expect(store.token).toBe('rotated');
  });

  it('logout vide le jeton stocké', async () => {
    const { client, store } = nativeSetup([jsonResponse(204)]);
    await client.logout();
    expect(store.token).toBeUndefined();
  });
});
