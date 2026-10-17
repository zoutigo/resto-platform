import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import { ThrottleService } from './throttle.service.js';

const NOW = new Date('2026-10-17T10:00:00Z');

function setup(failureTimes: Date[]) {
  const prisma = {
    authAttempt: {
      findMany: vi.fn().mockResolvedValue(failureTimes.map((createdAt) => ({ createdAt }))),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  return { prisma, service: new ThrottleService(prisma as unknown as PrismaService) };
}

const secondsAgo = (n: number) => new Date(NOW.getTime() - n * 1000);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ThrottleService.assertAllowed', () => {
  it('laisse passer sous le seuil', async () => {
    const { service } = setup([secondsAgo(1), secondsAgo(2), secondsAgo(3), secondsAgo(4)]);
    await expect(service.assertAllowed([{ key: 'k', free: 5 }])).resolves.toBeUndefined();
  });

  it('impose 30 s après le seuil, avec Retry-After', async () => {
    const { service } = setup([1, 2, 3, 4, 5].map(secondsAgo));
    await expect(service.assertAllowed([{ key: 'k', free: 5 }])).rejects.toMatchObject({
      status: 429,
      response: { message: 'auth.tooManyAttempts', retryAfter: 29 },
    });
  });

  it('libère une fois le délai écoulé', async () => {
    const { service } = setup([31, 32, 33, 34, 35].map(secondsAgo));
    await expect(service.assertAllowed([{ key: 'k', free: 5 }])).resolves.toBeUndefined();
  });

  it('double le délai à chaque échec supplémentaire', async () => {
    const { service } = setup([1, 2, 3, 4, 5, 6, 7].map(secondsAgo)); // excès = 2 → 120 s
    await expect(service.assertAllowed([{ key: 'k', free: 5 }])).rejects.toMatchObject({
      response: { retryAfter: 119 },
    });
  });

  it('plafonne le délai à une heure', async () => {
    const times = Array.from({ length: 40 }, (_, i) => secondsAgo(i + 1));
    const { service } = setup(times);
    await expect(service.assertAllowed([{ key: 'k', free: 5 }])).rejects.toMatchObject({
      response: { retryAfter: 3599 },
    });
  });

  it('retient le délai le plus long parmi plusieurs clés', async () => {
    const prisma = {
      authAttempt: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ createdAt: secondsAgo(1) }]) // clé 1 : sous le seuil
          .mockResolvedValueOnce([1, 2, 3].map((n) => ({ createdAt: secondsAgo(n) }))), // clé 2
      },
    };
    const service = new ThrottleService(prisma as unknown as PrismaService);
    await expect(
      service.assertAllowed([
        { key: 'a', free: 5 },
        { key: 'b', free: 2 },
      ]),
    ).rejects.toMatchObject({ status: 429, response: { retryAfter: 59 } });
  });

  it('ne regarde que la fenêtre d’une heure', async () => {
    const { prisma, service } = setup([]);
    await service.assertAllowed([{ key: 'k', free: 5 }]);
    const where = prisma.authAttempt.findMany.mock.calls[0]?.[0].where;
    expect(where.key).toBe('k');
    expect(where.success).toBe(false);
    expect(where.createdAt.gt.getTime()).toBe(NOW.getTime() - 3_600_000);
  });
});

describe('ThrottleService.recordFailure / clear', () => {
  it('enregistre un échec par clé et purge l’ancien', async () => {
    const { prisma, service } = setup([]);
    await service.recordFailure(['a', 'b']);
    expect(prisma.authAttempt.createMany).toHaveBeenCalledWith({
      data: [
        { key: 'a', success: false },
        { key: 'b', success: false },
      ],
    });
    expect(prisma.authAttempt.deleteMany).toHaveBeenCalledOnce();
  });

  it('clear efface les tentatives de la clé', async () => {
    const { prisma, service } = setup([]);
    await service.clear('a');
    expect(prisma.authAttempt.deleteMany).toHaveBeenCalledWith({ where: { key: 'a' } });
  });
});
