import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import { loadAuthConfig } from './auth.config.js';
import { HasherService } from './hasher.service.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';

const NOW = new Date('2026-10-17T10:00:00Z');
const config = loadAuthConfig();
const hasher = new HasherService(config);
const tokens = new TokenService(config);

function setup() {
  const refreshToken = {
    create: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma = { refreshToken } as unknown as PrismaService;
  return { refreshToken, service: new SessionService(prisma, hasher, tokens, config) };
}

const stored = (over: Record<string, unknown> = {}) => ({
  id: 'rt1',
  userId: 'u1',
  audience: 'STAFF',
  familyId: 'fam1',
  deviceId: 'dev1',
  usedAt: null,
  revokedAt: null,
  expiresAt: new Date(NOW.getTime() + 86_400_000),
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('SessionService.issue', () => {
  it('stocke uniquement l’empreinte du refresh token', async () => {
    const { refreshToken, service } = setup();
    const session = await service.issue('u1', 'staff', { userAgent: 'UA', deviceId: 'd' });
    const data = refreshToken.create.mock.calls[0]?.[0].data;
    expect(data.tokenHash).toBe(hasher.fingerprint(session.refreshToken));
    expect(JSON.stringify(data)).not.toContain(session.refreshToken);
    expect(data.audience).toBe('STAFF');
    expect(data.expiresAt.getTime()).toBe(NOW.getTime() + config.refreshTtlSeconds * 1000);
    expect(await tokens.verifyAccess(session.accessToken, 'staff')).toMatchObject({ userId: 'u1' });
  });

  it('ouvre une nouvelle famille à chaque connexion', async () => {
    const { refreshToken, service } = setup();
    await service.issue('u1', 'staff', {});
    await service.issue('u1', 'staff', {});
    const [a, b] = refreshToken.create.mock.calls.map((c) => c[0].data.familyId);
    expect(a).not.toBe(b);
  });
});

describe('SessionService.rotate', () => {
  it('échange le jeton et garde la famille et l’appareil', async () => {
    const { refreshToken, service } = setup();
    refreshToken.findUnique.mockResolvedValueOnce(stored());
    const next = await service.rotate('tok', 'staff', {});
    expect(next.refreshToken).not.toBe('tok');
    const created = refreshToken.create.mock.calls[0]?.[0].data;
    expect(created.familyId).toBe('fam1');
    expect(created.deviceId).toBe('dev1');
    expect(refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'rt1', usedAt: null },
      data: { usedAt: NOW },
    });
  });

  it('refuse un jeton inconnu', async () => {
    const { refreshToken, service } = setup();
    refreshToken.findUnique.mockResolvedValueOnce(null);
    await expect(service.rotate('x', 'staff', {})).rejects.toMatchObject({ status: 401 });
  });

  it('refuse un jeton de l’autre espace', async () => {
    const { refreshToken, service } = setup();
    refreshToken.findUnique.mockResolvedValueOnce(stored({ audience: 'CUSTOMER' }));
    await expect(service.rotate('tok', 'staff', {})).rejects.toMatchObject({ status: 401 });
    expect(refreshToken.create).not.toHaveBeenCalled();
  });

  it('refuse un jeton révoqué ou expiré', async () => {
    const { refreshToken, service } = setup();
    refreshToken.findUnique.mockResolvedValueOnce(stored({ revokedAt: NOW }));
    await expect(service.rotate('tok', 'staff', {})).rejects.toMatchObject({ status: 401 });
    refreshToken.findUnique.mockResolvedValueOnce(
      stored({ expiresAt: new Date(NOW.getTime() - 1) }),
    );
    await expect(service.rotate('tok', 'staff', {})).rejects.toMatchObject({ status: 401 });
  });

  it('révoque la famille quand un jeton déjà échangé est rejoué tard', async () => {
    const { refreshToken, service } = setup();
    const usedAt = new Date(NOW.getTime() - 60_000);
    refreshToken.findUnique
      .mockResolvedValueOnce(stored({ usedAt }))
      .mockResolvedValueOnce(stored({ usedAt }));
    refreshToken.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 3 });
    await expect(service.rotate('tok', 'staff', {})).rejects.toMatchObject({ status: 401 });
    expect(refreshToken.updateMany).toHaveBeenLastCalledWith({
      where: { familyId: 'fam1', revokedAt: null },
      data: { revokedAt: NOW },
    });
    expect(refreshToken.create).not.toHaveBeenCalled();
  });

  it('tolère un rejeu quasi simultané (deux onglets) sans révoquer', async () => {
    const { refreshToken, service } = setup();
    const usedAt = new Date(NOW.getTime() - 2_000);
    refreshToken.findUnique
      .mockResolvedValueOnce(stored({ usedAt }))
      .mockResolvedValueOnce(stored({ usedAt }));
    refreshToken.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.rotate('tok', 'staff', {})).rejects.toMatchObject({ status: 401 });
    expect(refreshToken.updateMany).toHaveBeenCalledOnce();
  });
});

describe('SessionService.revoke', () => {
  it('révoque la famille du jeton présenté', async () => {
    const { refreshToken, service } = setup();
    refreshToken.findUnique.mockResolvedValueOnce(stored());
    await service.revoke('tok');
    expect(refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: 'fam1', revokedAt: null },
      data: { revokedAt: NOW },
    });
  });

  it('ignore un jeton inconnu', async () => {
    const { refreshToken, service } = setup();
    refreshToken.findUnique.mockResolvedValueOnce(null);
    await expect(service.revoke('x')).resolves.toBeUndefined();
    expect(refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('revokeAllForUser cible toutes les sessions actives de l’utilisateur', async () => {
    const { refreshToken, service } = setup();
    await service.revokeAllForUser('u1');
    expect(refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: NOW },
    });
  });
});
