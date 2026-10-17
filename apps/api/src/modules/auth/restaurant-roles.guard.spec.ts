import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import { RestaurantRoles, RestaurantRolesGuard } from './restaurant-roles.guard.js';

class Routes {
  @RestaurantRoles('OWNER', 'SUPERVISOR')
  managers() {}
  @RestaurantRoles()
  anyMember() {}
}

const findUnique = vi.fn();
const guard = new RestaurantRolesGuard(new Reflector(), {
  membership: { findUnique },
} as unknown as PrismaService);

function context(method: 'managers' | 'anyMember', req: Record<string, unknown>) {
  const request = { params: { restaurantId: 'r1' }, auth: { userId: 'u1' }, ...req };
  return {
    ctx: {
      getHandler: () => Routes.prototype[method],
      getClass: () => Routes,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
    request,
  };
}

beforeEach(() => {
  findUnique.mockReset();
});

describe('RestaurantRolesGuard', () => {
  it('accepte un rôle autorisé et pose l’appartenance', async () => {
    findUnique.mockResolvedValue({ role: 'SUPERVISOR', status: 'ACTIVE' });
    const { ctx, request } = context('managers', {});
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(request).toMatchObject({
      membership: { restaurantId: 'r1', userId: 'u1', role: 'SUPERVISOR' },
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_restaurantId: { userId: 'u1', restaurantId: 'r1' } },
      }),
    );
  });

  it('refuse (403) un membre dont le rôle est insuffisant', async () => {
    findUnique.mockResolvedValue({ role: 'WAITER', status: 'ACTIVE' });
    await expect(guard.canActivate(context('managers', {}).ctx)).rejects.toMatchObject({
      status: 403,
      response: { message: 'restaurant.forbiddenRole' },
    });
  });

  it('accepte tout membre actif quand aucun rôle n’est listé', async () => {
    findUnique.mockResolvedValue({ role: 'PREPARATOR', status: 'ACTIVE' });
    expect(await guard.canActivate(context('anyMember', {}).ctx)).toBe(true);
  });

  it('répond 404 à un non-membre (indiscernable d’un restaurant inexistant)', async () => {
    findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(context('anyMember', {}).ctx)).rejects.toMatchObject({
      status: 404,
      response: { message: 'restaurant.notFound' },
    });
  });

  it.each(['PENDING', 'REVOKED'])('répond 404 à un membre %s', async (status) => {
    findUnique.mockResolvedValue({ role: 'OWNER', status });
    await expect(guard.canActivate(context('managers', {}).ctx)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('répond 404 sans identifiant de restaurant ou sans utilisateur', async () => {
    await expect(guard.canActivate(context('managers', { params: {} }).ctx)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      guard.canActivate(context('managers', { auth: undefined }).ctx),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('ignore un paramètre multiple', async () => {
    const { ctx } = context('managers', { params: { restaurantId: ['a', 'b'] } });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 404 });
    expect(findUnique).not.toHaveBeenCalled();
  });
});
