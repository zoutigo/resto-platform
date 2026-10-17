import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AccessTokenGuard, Authenticated } from './auth.guard.js';
import { loadAuthConfig } from './auth.config.js';
import { TokenService } from './token.service.js';

const tokens = new TokenService(loadAuthConfig());
const guard = new AccessTokenGuard(new Reflector(), tokens);

class Open {
  handler() {}
}
class Protected {
  @Authenticated('staff')
  handler() {}
  @Authenticated()
  dynamic() {}
}

function context(
  target: new () => object,
  method: string,
  req: { headers?: Record<string, string>; params?: Record<string, string> },
): ExecutionContext {
  const request = { headers: {}, params: {}, ...req };
  return {
    getHandler: () => (target.prototype as Record<string, () => void>)[method],
    getClass: () => target,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('AccessTokenGuard', () => {
  it('laisse passer les routes publiques', async () => {
    expect(await guard.canActivate(context(Open, 'handler', {}))).toBe(true);
  });

  it('refuse sans en-tête Authorization', async () => {
    await expect(guard.canActivate(context(Protected, 'handler', {}))).rejects.toMatchObject({
      status: 401,
      response: { message: 'auth.missingToken' },
    });
  });

  it('refuse un schéma autre que Bearer', async () => {
    const ctx = context(Protected, 'handler', { headers: { authorization: 'Basic abc' } });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 401 });
  });

  it('accepte un jeton du bon espace et pose l’identité', async () => {
    const jwt = await tokens.signAccess({ userId: 'u1', audience: 'staff' });
    const ctx = context(Protected, 'handler', { headers: { authorization: `Bearer ${jwt}` } });
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(ctx.switchToHttp().getRequest()).toMatchObject({
      auth: { userId: 'u1', audience: 'staff' },
    });
  });

  it('refuse un jeton client sur une route du personnel', async () => {
    const jwt = await tokens.signAccess({ userId: 'u1', audience: 'customer' });
    const ctx = context(Protected, 'handler', { headers: { authorization: `Bearer ${jwt}` } });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 401 });
  });

  it('lit l’espace dans la route quand il est dynamique', async () => {
    const jwt = await tokens.signAccess({ userId: 'u1', audience: 'customer' });
    const headers = { authorization: `Bearer ${jwt}` };
    expect(
      await guard.canActivate(
        context(Protected, 'dynamic', { headers, params: { audience: 'customer' } }),
      ),
    ).toBe(true);
    await expect(
      guard.canActivate(context(Protected, 'dynamic', { headers, params: { audience: 'staff' } })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('répond 404 pour un espace inconnu', async () => {
    const ctx = context(Protected, 'dynamic', { headers: {}, params: { audience: 'admin' } });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 404 });
  });
});
