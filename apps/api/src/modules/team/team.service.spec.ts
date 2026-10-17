import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import type { AuditService } from '../auth/audit.service.js';
import { loadAuthConfig } from '../auth/auth.config.js';
import { HasherService } from '../auth/hasher.service.js';
import type { ActiveMembership } from '../auth/restaurant-roles.guard.js';
import type { SessionService } from '../auth/session.service.js';
import { TeamService } from './team.service.js';

const hasher = new HasherService(loadAuthConfig());
const owner: ActiveMembership = { restaurantId: 'r1', userId: 'owner', role: 'OWNER' };
const supervisor: ActiveMembership = { restaurantId: 'r1', userId: 'sup', role: 'SUPERVISOR' };

const memberRow = (
  userId: string,
  role: string,
  over: Record<string, unknown> = {},
  status = 'ACTIVE',
) => ({
  role,
  status,
  user: {
    id: userId,
    name: `Nom ${userId}`,
    phone: '+237655000001',
    managedByRestaurantId: 'r1',
    credentials: [{ mustChange: true }],
    ...over,
  },
});

function setup() {
  const prisma = {
    user: { findUnique: vi.fn(), create: vi.fn().mockResolvedValue({ id: 'new' }) },
    membership: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    credential: { upsert: vi.fn().mockResolvedValue({}) },
  };
  const sessions = { revokeAllForUser: vi.fn().mockResolvedValue(undefined) };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const service = new TeamService(
    prisma as unknown as PrismaService,
    hasher,
    sessions as unknown as SessionService,
    audit as unknown as AuditService,
  );
  return { prisma, sessions, audit, service };
}

let ctx: ReturnType<typeof setup>;
beforeEach(() => {
  ctx = setup();
});

describe('TeamService.list', () => {
  it('ne liste que les membres actifs du restaurant demandé, sans donnée sensible', async () => {
    ctx.prisma.membership.findMany.mockResolvedValue([memberRow('w1', 'WAITER')]);
    const list = await ctx.service.list('r1');
    expect(ctx.prisma.membership.findMany.mock.calls[0]?.[0].where).toEqual({
      restaurantId: 'r1',
      status: 'ACTIVE',
    });
    expect(list).toEqual([
      {
        userId: 'w1',
        name: 'Nom w1',
        phone: '+237655000001',
        role: 'WAITER',
        mustChangePin: true,
        pinResettable: true,
      },
    ]);
  });
});

describe('TeamService.add', () => {
  const input = { name: 'Jean Nkoulou', phone: '+237655112233', role: 'WAITER' as const };

  it('crée un compte géré avec PIN temporaire renvoyé une fois', async () => {
    ctx.prisma.user.findUnique.mockResolvedValue(null);
    ctx.prisma.membership.findUniqueOrThrow.mockResolvedValue(memberRow('new', 'WAITER'));
    const result = await ctx.service.add(owner, input);

    const data = ctx.prisma.user.create.mock.calls[0]?.[0].data;
    expect(data.managedByRestaurantId).toBe('r1');
    expect(data.credentials.create.mustChange).toBe(true);
    expect(data.memberships.create).toMatchObject({
      restaurantId: 'r1',
      role: 'WAITER',
      status: 'ACTIVE',
    });
    expect(result.temporaryPin).toMatch(/^\d{6}$/);
    expect(await hasher.verifySecret(data.credentials.create.hash, result.temporaryPin!)).toBe(
      true,
    );
    expect(JSON.stringify(data)).not.toContain(result.temporaryPin);
    expect(JSON.stringify(ctx.audit.log.mock.calls)).not.toContain(result.temporaryPin);
  });

  it('rattache un compte existant sans toucher à son PIN ni le « gérer »', async () => {
    ctx.prisma.user.findUnique.mockResolvedValue({ id: 'u9', memberships: [] });
    ctx.prisma.membership.findUniqueOrThrow.mockResolvedValue(
      memberRow('u9', 'WAITER', { managedByRestaurantId: null }),
    );
    const result = await ctx.service.add(owner, input);
    expect(result.temporaryPin).toBeNull();
    expect(result.member.pinResettable).toBe(false);
    expect(ctx.prisma.user.create).not.toHaveBeenCalled();
    expect(ctx.prisma.credential.upsert).not.toHaveBeenCalled();
    expect(ctx.prisma.membership.upsert).toHaveBeenCalledOnce();
  });

  it('refuse un membre déjà actif (409)', async () => {
    ctx.prisma.user.findUnique.mockResolvedValue({
      id: 'u9',
      memberships: [{ status: 'ACTIVE', role: 'WAITER' }],
    });
    await expect(ctx.service.add(owner, input)).rejects.toMatchObject({ status: 409 });
  });

  it('réactive un ancien membre révoqué', async () => {
    ctx.prisma.user.findUnique.mockResolvedValue({
      id: 'u9',
      memberships: [{ status: 'REVOKED', role: 'CASHIER' }],
    });
    ctx.prisma.membership.findUniqueOrThrow.mockResolvedValue(memberRow('u9', 'WAITER'));
    await ctx.service.add(owner, input);
    expect(ctx.prisma.membership.upsert.mock.calls[0]?.[0].update).toMatchObject({
      role: 'WAITER',
      status: 'ACTIVE',
    });
  });

  it('un gérant ne peut pas créer un autre gérant', async () => {
    await expect(
      ctx.service.add(supervisor, { ...input, role: 'SUPERVISOR' }),
    ).rejects.toMatchObject({
      status: 403,
    });
    expect(ctx.prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('un gérant ne peut pas réactiver un ancien gérant à un rôle inférieur', async () => {
    ctx.prisma.user.findUnique.mockResolvedValue({
      id: 'u9',
      memberships: [{ status: 'REVOKED', role: 'SUPERVISOR' }],
    });
    await expect(ctx.service.add(supervisor, input)).rejects.toMatchObject({ status: 403 });
  });
});

describe('TeamService.changeRole', () => {
  it('change le rôle d’un membre du restaurant', async () => {
    ctx.prisma.membership.findUnique.mockResolvedValue(memberRow('w1', 'WAITER'));
    ctx.prisma.membership.findUniqueOrThrow.mockResolvedValue(memberRow('w1', 'CASHIER'));
    const view = await ctx.service.changeRole(owner, 'w1', 'CASHIER');
    expect(view.role).toBe('CASHIER');
    expect(ctx.prisma.membership.update).toHaveBeenCalledWith({
      where: { userId_restaurantId: { userId: 'w1', restaurantId: 'r1' } },
      data: { role: 'CASHIER' },
    });
  });

  it('refuse de promouvoir au-dessus de son propre niveau', async () => {
    ctx.prisma.membership.findUnique.mockResolvedValue(memberRow('w1', 'WAITER'));
    await expect(ctx.service.changeRole(supervisor, 'w1', 'SUPERVISOR')).rejects.toMatchObject({
      status: 403,
    });
    expect(ctx.prisma.membership.update).not.toHaveBeenCalled();
  });

  it('refuse de toucher à un propriétaire', async () => {
    ctx.prisma.membership.findUnique.mockResolvedValue(memberRow('o2', 'OWNER'));
    await expect(ctx.service.changeRole(owner, 'o2', 'WAITER')).rejects.toMatchObject({
      status: 403,
    });
  });

  it.each([null, memberRow('w1', 'WAITER', {}, 'REVOKED')])(
    '404 pour un membre absent ou révoqué',
    async (found) => {
      ctx.prisma.membership.findUnique.mockResolvedValue(found);
      await expect(ctx.service.changeRole(owner, 'w1', 'CASHIER')).rejects.toMatchObject({
        status: 404,
      });
    },
  );
});

describe('TeamService.resetPin', () => {
  it('pose un PIN temporaire, déconnecte l’employé et journalise sans le PIN', async () => {
    ctx.prisma.membership.findUnique.mockResolvedValue(memberRow('w1', 'WAITER'));
    const { temporaryPin } = await ctx.service.resetPin(owner, 'w1');
    expect(temporaryPin).toMatch(/^\d{6}$/);
    const call = ctx.prisma.credential.upsert.mock.calls[0]?.[0];
    expect(call.update.mustChange).toBe(true);
    expect(await hasher.verifySecret(call.update.hash, temporaryPin)).toBe(true);
    expect(ctx.sessions.revokeAllForUser).toHaveBeenCalledWith('w1');
    expect(JSON.stringify(ctx.audit.log.mock.calls)).not.toContain(temporaryPin);
  });

  it('refuse un compte non créé par ce restaurant (client, autre restaurateur)', async () => {
    ctx.prisma.membership.findUnique.mockResolvedValue(
      memberRow('w1', 'WAITER', { managedByRestaurantId: null }),
    );
    await expect(ctx.service.resetPin(owner, 'w1')).rejects.toMatchObject({
      status: 403,
      response: { message: 'team.accountNotManaged' },
    });
    expect(ctx.prisma.credential.upsert).not.toHaveBeenCalled();
    expect(ctx.sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('refuse un compte géré par un autre restaurant', async () => {
    ctx.prisma.membership.findUnique.mockResolvedValue(
      memberRow('w1', 'WAITER', { managedByRestaurantId: 'r2' }),
    );
    await expect(ctx.service.resetPin(owner, 'w1')).rejects.toMatchObject({ status: 403 });
  });

  it('un gérant ne réinitialise pas le PIN d’un autre gérant ni du propriétaire', async () => {
    for (const role of ['SUPERVISOR', 'OWNER']) {
      ctx.prisma.membership.findUnique.mockResolvedValue(memberRow('x', role));
      await expect(ctx.service.resetPin(supervisor, 'x')).rejects.toMatchObject({ status: 403 });
    }
    expect(ctx.prisma.credential.upsert).not.toHaveBeenCalled();
  });
});

describe('TeamService.remove', () => {
  it('révoque l’accès sans supprimer le compte', async () => {
    ctx.prisma.membership.findUnique.mockResolvedValue(memberRow('w1', 'WAITER'));
    await ctx.service.remove(owner, 'w1');
    expect(ctx.prisma.membership.update).toHaveBeenCalledWith({
      where: { userId_restaurantId: { userId: 'w1', restaurantId: 'r1' } },
      data: { status: 'REVOKED' },
    });
  });

  it('refuse de retirer un propriétaire ou un pair', async () => {
    ctx.prisma.membership.findUnique.mockResolvedValue(memberRow('o2', 'OWNER'));
    await expect(ctx.service.remove(owner, 'o2')).rejects.toMatchObject({ status: 403 });
    ctx.prisma.membership.findUnique.mockResolvedValue(memberRow('s2', 'SUPERVISOR'));
    await expect(ctx.service.remove(supervisor, 's2')).rejects.toMatchObject({ status: 403 });
    expect(ctx.prisma.membership.update).not.toHaveBeenCalled();
  });

  it('cherche toujours la cible dans le restaurant de l’acteur', async () => {
    ctx.prisma.membership.findUnique.mockResolvedValue(null);
    await expect(ctx.service.remove(owner, 'stranger')).rejects.toMatchObject({ status: 404 });
    expect(ctx.prisma.membership.findUnique.mock.calls[0]?.[0].where).toEqual({
      userId_restaurantId: { userId: 'stranger', restaurantId: 'r1' },
    });
  });
});
