import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import type { AuditService } from '../auth/audit.service.js';
import type { ThrottleService } from '../auth/throttle.service.js';
import { RestaurantsService } from './restaurants.service.js';

const row = (over = {}) => ({
  id: 'r1',
  slug: 'chez-mama',
  name: 'Chez Mama',
  city: 'Douala',
  address: null,
  isPublic: false,
  description: 'ne doit pas fuiter',
  ...over,
});

function setup() {
  const prisma = {
    restaurant: { create: vi.fn(), findUnique: vi.fn() },
    membership: { findMany: vi.fn() },
  };
  const throttle = {
    assertAllowed: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const service = new RestaurantsService(
    prisma as unknown as PrismaService,
    throttle as unknown as ThrottleService,
    audit as unknown as AuditService,
  );
  return { prisma, throttle, audit, service };
}

const input = { name: 'Chez Mama', city: 'Douala' };
let uniqueError: Error;
beforeEach(() => {
  uniqueError = Object.assign(new Error('dup'), { code: 'P2002' });
});

describe('RestaurantsService.create', () => {
  it('crée le restaurant avec le créateur comme propriétaire actif', async () => {
    const { prisma, audit, service } = setup();
    prisma.restaurant.create.mockResolvedValue(row());
    const result = await service.create('u1', input);
    expect(prisma.restaurant.create.mock.calls[0]?.[0].data).toMatchObject({
      slug: 'chez-mama',
      name: 'Chez Mama',
      memberships: { create: { userId: 'u1', role: 'OWNER', status: 'ACTIVE' } },
    });
    expect(result).toEqual({
      id: 'r1',
      slug: 'chez-mama',
      name: 'Chez Mama',
      city: 'Douala',
      address: null,
      isPublic: false,
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'restaurant.created', restaurantId: 'r1' }),
    );
  });

  it('suffixe le slug quand il est pris', async () => {
    const { prisma, service } = setup();
    prisma.restaurant.create.mockRejectedValueOnce(uniqueError).mockResolvedValueOnce(row());
    await service.create('u1', input);
    const slugs = prisma.restaurant.create.mock.calls.map((c) => c[0].data.slug);
    expect(slugs[0]).toBe('chez-mama');
    expect(slugs[1]).toMatch(/^chez-mama-[0-9a-f]{4}$/);
  });

  it('abandonne en 409 après plusieurs collisions', async () => {
    const { prisma, service } = setup();
    prisma.restaurant.create.mockRejectedValue(uniqueError);
    await expect(service.create('u1', input)).rejects.toMatchObject({ status: 409 });
    expect(prisma.restaurant.create).toHaveBeenCalledTimes(4);
  });

  it('laisse remonter une autre erreur', async () => {
    const { prisma, service } = setup();
    prisma.restaurant.create.mockRejectedValue(new Error('boom'));
    await expect(service.create('u1', input)).rejects.toThrow('boom');
  });

  it('limite les créations par utilisateur', async () => {
    const { prisma, throttle, service } = setup();
    throttle.assertAllowed.mockRejectedValue(Object.assign(new Error('429'), { status: 429 }));
    await expect(service.create('u1', input)).rejects.toMatchObject({ status: 429 });
    expect(prisma.restaurant.create).not.toHaveBeenCalled();
    expect(throttle.assertAllowed.mock.calls[0]?.[0][0]).toEqual({
      key: 'restaurant:create:u1',
      free: 5,
    });
  });
});

describe('RestaurantsService — lecture', () => {
  it('listMine ne renvoie que des champs publics', async () => {
    const { prisma, service } = setup();
    prisma.membership.findMany.mockResolvedValue([{ role: 'OWNER', restaurant: row() }]);
    const list = await service.listMine('u1');
    expect(prisma.membership.findMany.mock.calls[0]?.[0].where).toEqual({
      userId: 'u1',
      status: 'ACTIVE',
    });
    expect(JSON.stringify(list)).not.toContain('fuiter');
    expect(list[0]?.role).toBe('OWNER');
  });

  it('get renvoie 404 pour un restaurant absent', async () => {
    const { prisma, service } = setup();
    prisma.restaurant.findUnique.mockResolvedValue(null);
    await expect(service.get('nope')).rejects.toMatchObject({ status: 404 });
  });
});
