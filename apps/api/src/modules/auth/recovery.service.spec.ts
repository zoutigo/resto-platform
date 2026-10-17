import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import type { AuditService } from './audit.service.js';
import { loadAuthConfig } from './auth.config.js';
import { HasherService } from './hasher.service.js';
import { RecoveryService, recoveryPolicy } from './recovery.service.js';
import type { SessionService } from './session.service.js';
import type { ThrottleService } from './throttle.service.js';

const NOW = new Date('2026-10-17T10:00:00Z');
const HOUR = 3_600_000;
const hasher = new HasherService(loadAuthConfig());
const session = {
  userId: 'u1',
  accessToken: 'a',
  expiresIn: 900,
  refreshToken: 'r',
  refreshTtlSeconds: 1,
};
const ctx = { ip: '10.0.0.1' };

const userRow = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  name: 'Awa',
  phone: '+237677123456',
  phoneVerifiedAt: null,
  email: null,
  emailVerifiedAt: null,
  restrictedUntil: null,
  ...over,
});

function setup() {
  const tx = vi.fn().mockImplementation(async (ops: unknown[]) => Promise.all(ops));
  const prisma = {
    $transaction: tx,
    user: {
      findUnique: vi.fn(),
      update: vi.fn().mockImplementation(async ({ data }) => userRow(data)),
    },
    credential: { upsert: vi.fn().mockResolvedValue({}), findUnique: vi.fn() },
    recoveryCode: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({}),
    },
    recoveryRequest: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn(),
    },
  };
  const sessions = {
    issue: vi.fn().mockResolvedValue(session),
    revokeAllForUser: vi.fn().mockResolvedValue(undefined),
  };
  const throttle = {
    assertAllowed: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const service = new RecoveryService(
    prisma as unknown as PrismaService,
    hasher,
    sessions as unknown as SessionService,
    throttle as unknown as ThrottleService,
    audit as unknown as AuditService,
  );
  return { prisma, sessions, throttle, audit, service };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('recoveryPolicy', () => {
  it.each([
    [[], { minAnswers: 1, delayHours: 0 }],
    [['WAITER'], { minAnswers: 1, delayHours: 24 }],
    [['CASHIER', 'PREPARATOR'], { minAnswers: 1, delayHours: 24 }],
    [['SUPERVISOR'], { minAnswers: 2, delayHours: 48 }],
    [['OWNER'], { minAnswers: 2, delayHours: 48 }],
    [['WAITER', 'OWNER'], { minAnswers: 2, delayHours: 48 }],
  ])('rôles %j → %j', (roles, expected) => {
    expect(recoveryPolicy(roles)).toEqual(expected);
  });
});

describe('RecoveryService.recoverWithCode', () => {
  const input = {
    phone: '+237677123456',
    recoveryCode: 'abcd-efgh-jkmn',
    newPin: '715204',
    newPinConfirm: '715204',
  };

  async function withCode() {
    const codeHash = await hasher.hashSecret('ABCDEFGHJKMN');
    return userRow({ recoveryCodes: [{ id: 'c1', codeHash }] });
  }

  it('change le PIN, invalide l’ancien code, en remet un neuf et coupe les sessions', async () => {
    const c = setup();
    c.prisma.user.findUnique.mockResolvedValue(await withCode());
    const result = await c.service.recoverWithCode('staff', input, ctx);

    const upsert = c.prisma.credential.upsert.mock.calls[0]?.[0];
    expect(await hasher.verifySecret(upsert.update.hash, '715204')).toBe(true);
    expect(upsert.update.mustChange).toBe(false);
    expect(c.prisma.recoveryCode.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { userId: 'u1', usedAt: null },
    });
    const created = c.prisma.recoveryCode.create.mock.calls[0]?.[0].data;
    expect(
      await hasher.verifySecret(
        created.codeHash,
        hasher.normalizeRecoveryCode(result.recoveryCode)!,
      ),
    ).toBe(true);
    expect(result.recoveryCode).not.toBe('ABCD-EFGH-JKMN');
    expect(JSON.stringify(c.prisma.recoveryCode.create.mock.calls)).not.toContain(
      result.recoveryCode,
    );
    expect(c.sessions.revokeAllForUser).toHaveBeenCalledWith('u1');
    expect(c.throttle.clear).toHaveBeenCalledWith('recover:phone:+237677123456');
    expect(c.sessions.issue).toHaveBeenCalledWith('u1', 'staff', ctx);
  });

  it('annule aussi une récupération différée en attente', async () => {
    const c = setup();
    c.prisma.user.findUnique.mockResolvedValue(await withCode());
    await c.service.recoverWithCode('staff', input, ctx);
    expect(c.prisma.recoveryRequest.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { userId: 'u1', status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
  });

  it.each([
    ['mauvais code', { recoveryCode: 'ZZZZ-ZZZZ-ZZZZ' }],
    ['code mal formé', { recoveryCode: 'trop-court-0000' }],
  ])('échoue de façon générique : %s', async (_l, over) => {
    const c = setup();
    c.prisma.user.findUnique.mockResolvedValue(await withCode());
    await expect(
      c.service.recoverWithCode('staff', { ...input, ...over }, ctx),
    ).rejects.toMatchObject({
      status: 401,
      response: { message: 'recovery.failed' },
    });
    expect(c.throttle.recordFailure).toHaveBeenCalledWith([
      'recover:phone:+237677123456',
      'recover:ip:10.0.0.1',
    ]);
    expect(c.prisma.credential.upsert).not.toHaveBeenCalled();
    expect(c.sessions.issue).not.toHaveBeenCalled();
  });

  it('même échec pour un numéro inconnu ou sans code', async () => {
    const c = setup();
    c.prisma.user.findUnique.mockResolvedValue(null);
    await expect(c.service.recoverWithCode('staff', input, ctx)).rejects.toMatchObject({
      status: 401,
      response: { message: 'recovery.failed' },
    });
    c.prisma.user.findUnique.mockResolvedValue(userRow({ recoveryCodes: [] }));
    await expect(c.service.recoverWithCode('staff', input, ctx)).rejects.toMatchObject({
      status: 401,
      response: { message: 'recovery.failed' },
    });
  });

  it('un code déjà utilisé n’est jamais chargé (filtre usedAt: null)', async () => {
    const c = setup();
    c.prisma.user.findUnique.mockResolvedValue(await withCode());
    await c.service.recoverWithCode('staff', input, ctx);
    expect(c.prisma.user.findUnique.mock.calls[0]?.[0].include.recoveryCodes.where).toEqual({
      usedAt: null,
    });
  });

  it('respecte le ralentissement avant toute vérification', async () => {
    const c = setup();
    c.throttle.assertAllowed.mockRejectedValue(Object.assign(new Error('429'), { status: 429 }));
    await expect(c.service.recoverWithCode('staff', input, ctx)).rejects.toMatchObject({
      status: 429,
    });
    expect(c.prisma.user.findUnique).not.toHaveBeenCalled();
    expect(c.throttle.assertAllowed.mock.calls[0]?.[0]).toEqual([
      { key: 'recover:phone:+237677123456', free: 3 },
      { key: 'recover:ip:10.0.0.1', free: 20 },
    ]);
  });
});

describe('RecoveryService.recoverWithQuestions', () => {
  const input = {
    phone: '+237677123456',
    birthDate: '1990-03-05',
    recoveryAnswers: [{ question: 'BIRTH_CITY' as const, answer: 'Yaoundé' }],
    newPin: '715204',
    newPinConfirm: '715204',
  };

  async function profileUser(
    roles: string[] = [],
    answers = ['BIRTH_CITY:yaounde', 'FAVORITE_SPORT:fotbal'],
  ) {
    return userRow({
      memberships: roles.map((role) => ({ role })),
      recoveryProfile: {
        birthDateHash: await hasher.hashSecret('1990-03-05'),
        answers: await Promise.all(
          answers.map(async (a) => {
            const [question, value] = a.split(':');
            return { question, answerHash: await hasher.hashSecret(value!) };
          }),
        ),
      },
    });
  }

  describe('client (sans rôle)', () => {
    it('applique tout de suite le PIN et passe le compte en mode restreint 48 h', async () => {
      const c = setup();
      c.prisma.user.findUnique.mockResolvedValue(await profileUser());
      const result = await c.service.recoverWithQuestions('customer', input, ctx);
      expect(result.status).toBe('completed');
      expect(c.prisma.user.update.mock.calls[0]?.[0]).toEqual({
        where: { id: 'u1' },
        data: { restrictedUntil: new Date(NOW.getTime() + 48 * HOUR) },
      });
      expect(c.sessions.revokeAllForUser).toHaveBeenCalledWith('u1');
      expect(c.sessions.issue).toHaveBeenCalledWith('u1', 'customer', ctx);
      expect(c.prisma.recoveryRequest.create).not.toHaveBeenCalled();
      expect(c.throttle.clear).toHaveBeenCalled();
    });

    it('la réponse est normalisée (casse, accents)', async () => {
      const c = setup();
      c.prisma.user.findUnique.mockResolvedValue(await profileUser());
      const answers = [{ question: 'BIRTH_CITY' as const, answer: '  YAOUNDÉ ' }];
      expect(
        (
          await c.service.recoverWithQuestions(
            'customer',
            { ...input, recoveryAnswers: answers },
            ctx,
          )
        ).status,
      ).toBe('completed');
    });

    it.each([
      ['mauvaise date', { birthDate: '1990-03-06' }],
      [
        'mauvaise réponse',
        { recoveryAnswers: [{ question: 'BIRTH_CITY' as const, answer: 'Douala' }] },
      ],
      [
        'question jamais configurée',
        { recoveryAnswers: [{ question: 'FAVORITE_ANIMAL' as const, answer: 'lion' }] },
      ],
      [
        'une bonne et une mauvaise réponse',
        {
          recoveryAnswers: [
            { question: 'BIRTH_CITY' as const, answer: 'Yaoundé' },
            { question: 'FAVORITE_SPORT' as const, answer: 'tennis' },
          ],
        },
      ],
    ])('échoue de façon générique : %s', async (_l, over) => {
      const c = setup();
      c.prisma.user.findUnique.mockResolvedValue(await profileUser());
      await expect(
        c.service.recoverWithQuestions('customer', { ...input, ...over }, ctx),
      ).rejects.toMatchObject({
        status: 401,
        response: { message: 'recovery.failed' },
      });
      expect(c.throttle.recordFailure).toHaveBeenCalled();
      expect(c.prisma.credential.upsert).not.toHaveBeenCalled();
      expect(c.prisma.user.update).not.toHaveBeenCalled();
    });

    it('échoue pareil sans profil de récupération ou pour un numéro inconnu', async () => {
      const c = setup();
      c.prisma.user.findUnique.mockResolvedValue(
        userRow({ memberships: [], recoveryProfile: null }),
      );
      await expect(c.service.recoverWithQuestions('customer', input, ctx)).rejects.toMatchObject({
        response: { message: 'recovery.failed' },
      });
      c.prisma.user.findUnique.mockResolvedValue(null);
      await expect(c.service.recoverWithQuestions('customer', input, ctx)).rejects.toMatchObject({
        response: { message: 'recovery.failed' },
      });
    });
  });

  describe('compte ayant un rôle', () => {
    it('propriétaire : exige deux réponses (une seule échoue)', async () => {
      const c = setup();
      c.prisma.user.findUnique.mockResolvedValue(await profileUser(['OWNER']));
      await expect(c.service.recoverWithQuestions('staff', input, ctx)).rejects.toMatchObject({
        response: { message: 'recovery.failed' },
      });
      expect(c.prisma.recoveryRequest.create).not.toHaveBeenCalled();
    });

    it('propriétaire : deux bonnes réponses → demande différée de 48 h, rien n’est appliqué', async () => {
      const c = setup();
      c.prisma.user.findUnique.mockResolvedValue(await profileUser(['OWNER']));
      const answers = [
        { question: 'BIRTH_CITY' as const, answer: 'Yaoundé' },
        { question: 'FAVORITE_SPORT' as const, answer: 'Football' },
      ];
      const result = await c.service.recoverWithQuestions(
        'staff',
        { ...input, recoveryAnswers: answers },
        ctx,
      );
      expect(result).toEqual({
        status: 'pending',
        availableAt: new Date(NOW.getTime() + 48 * HOUR),
      });

      const created = c.prisma.recoveryRequest.create.mock.calls[0]?.[0].data;
      expect(created.userId).toBe('u1');
      expect(await hasher.verifySecret(created.newPinHash, '715204')).toBe(true);
      expect(JSON.stringify(created)).not.toContain('715204');
      expect(c.prisma.credential.upsert).not.toHaveBeenCalled();
      expect(c.sessions.revokeAllForUser).not.toHaveBeenCalled();
      expect(c.sessions.issue).not.toHaveBeenCalled();
      // Les demandes précédentes sont remplacées.
      expect(c.prisma.recoveryRequest.updateMany.mock.calls[0]?.[0]).toMatchObject({
        where: { userId: 'u1', status: 'PENDING' },
      });
    });

    it('employé : une réponse suffit mais le délai est de 24 h', async () => {
      const c = setup();
      c.prisma.user.findUnique.mockResolvedValue(await profileUser(['WAITER']));
      const result = await c.service.recoverWithQuestions('staff', input, ctx);
      expect(result).toEqual({
        status: 'pending',
        availableAt: new Date(NOW.getTime() + 24 * HOUR),
      });
    });

    it('le même compte qui répond sur la vitrine subit la même politique', async () => {
      const c = setup();
      c.prisma.user.findUnique.mockResolvedValue(await profileUser(['OWNER']));
      await expect(c.service.recoverWithQuestions('customer', input, ctx)).rejects.toMatchObject({
        status: 401,
      });
    });
  });
});

describe('RecoveryService.completePending', () => {
  const input = { phone: '+237677123456', newPin: '715204' };

  async function pending(availableAt: Date) {
    return { id: 'rr1', userId: 'u1', availableAt, newPinHash: await hasher.hashSecret('715204') };
  }

  it('applique le PIN choisi une fois le délai écoulé', async () => {
    const c = setup();
    c.prisma.user.findUnique.mockResolvedValue(userRow());
    c.prisma.recoveryRequest.findFirst.mockResolvedValue(
      await pending(new Date(NOW.getTime() - 1000)),
    );
    c.prisma.recoveryRequest.updateMany.mockResolvedValue({ count: 1 });
    const result = await c.service.completePending('staff', input, ctx);
    expect(result.session).toBe(session);
    expect(c.prisma.recoveryRequest.updateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: 'rr1', status: 'PENDING' },
      data: { status: 'COMPLETED', resolvedAt: NOW },
    });
    const upsert = c.prisma.credential.upsert.mock.calls[0]?.[0];
    expect(await hasher.verifySecret(upsert.update.hash, '715204')).toBe(true);
    expect(c.sessions.revokeAllForUser).toHaveBeenCalledWith('u1');
  });

  it('répond 409 avec l’échéance quand le délai court encore', async () => {
    const c = setup();
    const availableAt = new Date(NOW.getTime() + 5 * HOUR);
    c.prisma.user.findUnique.mockResolvedValue(userRow());
    c.prisma.recoveryRequest.findFirst.mockResolvedValue(await pending(availableAt));
    await expect(c.service.completePending('staff', input, ctx)).rejects.toMatchObject({
      status: 409,
      response: { message: 'recovery.notYetAvailable', availableAt: availableAt.toISOString() },
    });
    expect(c.prisma.credential.upsert).not.toHaveBeenCalled();
  });

  it('refuse un autre PIN que celui choisi au départ', async () => {
    const c = setup();
    c.prisma.user.findUnique.mockResolvedValue(userRow());
    c.prisma.recoveryRequest.findFirst.mockResolvedValue(
      await pending(new Date(NOW.getTime() - 1000)),
    );
    await expect(
      c.service.completePending('staff', { ...input, newPin: '111112' }, ctx),
    ).rejects.toMatchObject({
      response: { message: 'recovery.failed' },
    });
    expect(c.throttle.recordFailure).toHaveBeenCalled();
  });

  it('refuse sans demande en attente ou pour un inconnu', async () => {
    const c = setup();
    c.prisma.user.findUnique.mockResolvedValue(userRow());
    c.prisma.recoveryRequest.findFirst.mockResolvedValue(null);
    await expect(c.service.completePending('staff', input, ctx)).rejects.toMatchObject({
      status: 401,
    });
    c.prisma.user.findUnique.mockResolvedValue(null);
    await expect(c.service.completePending('staff', input, ctx)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('ne cherche que les demandes encore dans la fenêtre de 7 jours', async () => {
    const c = setup();
    c.prisma.user.findUnique.mockResolvedValue(userRow());
    c.prisma.recoveryRequest.findFirst.mockResolvedValue(null);
    await expect(c.service.completePending('staff', input, ctx)).rejects.toThrow();
    const where = c.prisma.recoveryRequest.findFirst.mock.calls[0]?.[0].where;
    expect(where.status).toBe('PENDING');
    expect(where.availableAt.gt.getTime()).toBe(NOW.getTime() - 7 * 24 * HOUR);
  });

  it('refuse si la demande a été annulée entre-temps (course)', async () => {
    const c = setup();
    c.prisma.user.findUnique.mockResolvedValue(userRow());
    c.prisma.recoveryRequest.findFirst.mockResolvedValue(
      await pending(new Date(NOW.getTime() - 1000)),
    );
    c.prisma.recoveryRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(c.service.completePending('staff', input, ctx)).rejects.toMatchObject({
      status: 401,
    });
    expect(c.prisma.credential.upsert).not.toHaveBeenCalled();
  });
});

describe('RecoveryService — annulation et état', () => {
  it('cancelOwn annule et journalise seulement s’il y avait quelque chose', async () => {
    const c = setup();
    c.prisma.recoveryRequest.updateMany.mockResolvedValue({ count: 2 });
    expect(await c.service.cancelOwn('u1')).toBe(2);
    expect(c.prisma.recoveryRequest.updateMany.mock.calls[0]?.[0].data).toMatchObject({
      status: 'CANCELLED',
      cancelledBy: 'owner',
    });
    expect(c.audit.log).toHaveBeenCalledOnce();

    const d = setup();
    expect(await d.service.cancelOwn('u1')).toBe(0);
    expect(d.audit.log).not.toHaveBeenCalled();
  });

  it('cancelOnLogin annule avec la mention « login »', async () => {
    const c = setup();
    c.prisma.recoveryRequest.updateMany.mockResolvedValue({ count: 1 });
    expect(await c.service.cancelOnLogin('u1')).toBe(true);
    expect(c.prisma.recoveryRequest.updateMany.mock.calls[0]?.[0].data.cancelledBy).toBe('login');
    expect(await setup().service.cancelOnLogin('u1')).toBe(false);
  });

  it('cancelForMember journalise toujours, avec le restaurant', async () => {
    const c = setup();
    c.prisma.recoveryRequest.updateMany.mockResolvedValue({ count: 1 });
    await c.service.cancelForMember('w1', 'boss', 'r1');
    expect(c.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'recovery.cancelled', userId: 'boss', restaurantId: 'r1' }),
    );
  });

  it('pendingFor renvoie l’échéance ou null', async () => {
    const c = setup();
    const availableAt = new Date();
    c.prisma.recoveryRequest.findFirst.mockResolvedValueOnce({ availableAt });
    expect(await c.service.pendingFor('u1')).toEqual({ availableAt });
    c.prisma.recoveryRequest.findFirst.mockResolvedValueOnce(null);
    expect(await c.service.pendingFor('u1')).toBeNull();
  });
});

describe('RecoveryService.regenerateCode', () => {
  it('invalide les anciens codes et en remet un neuf après vérification du PIN', async () => {
    const c = setup();
    c.prisma.credential.findUnique.mockResolvedValue({ hash: await hasher.hashSecret('483920') });
    const { recoveryCode } = await c.service.regenerateCode('u1', '483920', ctx);
    expect(recoveryCode).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/);
    expect(c.prisma.recoveryCode.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { userId: 'u1', usedAt: null },
    });
    expect(JSON.stringify(c.prisma.recoveryCode.create.mock.calls)).not.toContain(recoveryCode);
  });

  it('refuse un mauvais PIN et compte l’échec', async () => {
    const c = setup();
    c.prisma.credential.findUnique.mockResolvedValue({ hash: await hasher.hashSecret('483920') });
    await expect(c.service.regenerateCode('u1', '000001', ctx)).rejects.toMatchObject({
      status: 401,
    });
    expect(c.throttle.recordFailure).toHaveBeenCalledWith(['pin:user:u1']);
    expect(c.prisma.recoveryCode.create).not.toHaveBeenCalled();
  });

  it('refuse un compte sans PIN', async () => {
    const c = setup();
    c.prisma.credential.findUnique.mockResolvedValue(null);
    await expect(c.service.regenerateCode('u1', '483920', ctx)).rejects.toMatchObject({
      status: 401,
    });
  });
});
