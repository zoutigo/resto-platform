import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller.js';
import type { PrismaService } from './prisma.service.js';

describe('HealthController', () => {
  it('pingue la base et répond ok', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const res = await new HealthController(prisma as unknown as PrismaService).check();
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(res).toMatchObject({ status: 'ok', db: 'up' });
  });

  it('propage l’erreur si la base est injoignable', async () => {
    const prisma = { $queryRaw: vi.fn().mockRejectedValue(new Error('down')) };
    await expect(new HealthController(prisma as unknown as PrismaService).check()).rejects.toThrow(
      'down',
    );
  });
});
