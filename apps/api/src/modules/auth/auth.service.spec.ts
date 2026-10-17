import type { RegisterCustomer, RegisterOwner } from '@resto/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import type { AuditService } from './audit.service.js';
import { AuthService } from './auth.service.js';
import { toPublicUser } from './public-user.js';
import { loadAuthConfig } from './auth.config.js';
import { HasherService } from './hasher.service.js';
import type { RecoveryService } from './recovery.service.js';
import type { SessionService } from './session.service.js';
import type { ThrottleService } from './throttle.service.js';

const hasher = new HasherService(loadAuthConfig());

const session = {
  userId: 'u1',
  accessToken: 'a',
  expiresIn: 900,
  refreshToken: 'r',
  refreshTtlSeconds: 1,
};

const customer: RegisterCustomer = {
  name: 'Awa Mbarga',
  phone: '+237677123456',
  pin: '483920',
  pinConfirm: '483920',
  birthDate: '1990-03-05',
  recoveryAnswers: [{ question: 'BIRTH_CITY', answer: 'Yaoundé' }],
};

const owner: RegisterOwner = {
  firstName: 'Paul',
  lastName: 'Essomba',
  phone: '+237699887766',
  pin: '715204',
  pinConfirm: '715204',
  birthDate: '1980-11-12',
  recoveryAnswers: [
    { question: 'BIRTH_CITY', answer: 'Bafoussam' },
    { question: 'FAVORITE_SPORT', answer: 'Football' },
  ],
};

const userRow = (over = {}) => ({
  id: 'u1',
  name: 'Awa Mbarga',
  phone: '+237677123456',
  phoneVerifiedAt: null,
  email: null,
  emailVerifiedAt: null,
  restrictedUntil: null,
  ...over,
});

function setup() {
  const prisma = {
    user: { findUnique: vi.fn(), create: vi.fn() },
    credential: { findUnique: vi.fn(), update: vi.fn() },
  };
  const sessions = {
    issue: vi.fn().mockResolvedValue(session),
    rotate: vi.fn().mockResolvedValue(session),
    revoke: vi.fn().mockResolvedValue(undefined),
    revokeAllForUser: vi.fn().mockResolvedValue(undefined),
  };
  const throttle = {
    assertAllowed: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const recovery = {
    cancelOnLogin: vi.fn().mockResolvedValue(false),
    pendingFor: vi.fn().mockResolvedValue(null),
  };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    hasher,
    sessions as unknown as SessionService,
    throttle as unknown as ThrottleService,
    audit as unknown as AuditService,
    recovery as unknown as RecoveryService,
  );
  return { prisma, sessions, throttle, audit, recovery, service };
}

let ctx: { ip: string };
beforeEach(() => {
  ctx = { ip: '10.0.0.1' };
});

describe('AuthService.register', () => {
  it('crée un client : empreintes seulement, code de secours renvoyé une fois', async () => {
    const { prisma, service, sessions } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(userRow());
    const result = await service.register('customer', customer, ctx);

    const data = prisma.user.create.mock.calls[0]?.[0].data;
    expect(data.name).toBe('Awa Mbarga');
    expect(data.phone).toBe('+237677123456');
    const serialized = JSON.stringify(data);
    for (const secret of ['483920', '1990-03-05', 'Yaoundé', 'yaounde', result.recoveryCode]) {
      expect(serialized).not.toContain(secret);
    }
    expect(await hasher.verifySecret(data.credentials.create.hash, '483920')).toBe(true);
    expect(data.credentials.create.type).toBe('PIN');
    expect(await hasher.verifySecret(data.recoveryProfile.create.birthDateHash, '1990-03-05')).toBe(
      true,
    );
    expect(
      await hasher.verifySecret(
        data.recoveryProfile.create.answers.create[0].answerHash,
        'yaounde',
      ),
    ).toBe(true);
    expect(
      await hasher.verifySecret(
        data.recoveryCodes.create.codeHash,
        hasher.normalizeRecoveryCode(result.recoveryCode)!,
      ),
    ).toBe(true);
    expect(result.recoveryCode).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/);
    expect(sessions.issue).toHaveBeenCalledWith('u1', 'customer', ctx);
    expect(JSON.stringify(result.user)).not.toMatch(/hash|pin/i);
  });

  it('assemble prénom et nom pour un propriétaire et garde deux réponses', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(userRow({ name: 'Paul Essomba' }));
    await service.register('staff', owner, ctx);
    const data = prisma.user.create.mock.calls[0]?.[0].data;
    expect(data.name).toBe('Paul Essomba');
    expect(data.recoveryProfile.create.answers.create).toHaveLength(2);
  });

  it('refuse un numéro déjà inscrit avec 409', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(userRow());
    await expect(service.register('customer', customer, ctx)).rejects.toMatchObject({
      status: 409,
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('traduit une course sur la contrainte unique en 409', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(service.register('customer', customer, ctx)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('laisse remonter une autre erreur de base', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockRejectedValue(new Error('boom'));
    await expect(service.register('customer', customer, ctx)).rejects.toThrow('boom');
  });

  it('applique le ralentissement par IP avant tout travail', async () => {
    const { prisma, throttle, service } = setup();
    throttle.assertAllowed.mockRejectedValue(Object.assign(new Error('429'), { status: 429 }));
    await expect(service.register('customer', customer, ctx)).rejects.toMatchObject({
      status: 429,
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(throttle.assertAllowed.mock.calls[0]?.[0][0].key).toBe('register:ip:10.0.0.1');
  });
});

describe('AuthService.login', () => {
  const input = { phone: '+237677123456', pin: '483920' };

  async function userWithPin(pin = '483920', mustChange = false) {
    return userRow({ credentials: [{ id: 'c1', hash: await hasher.hashSecret(pin), mustChange }] });
  }

  it('connecte avec le bon PIN et remet à zéro le compteur du compte', async () => {
    const { prisma, throttle, sessions, service } = setup();
    prisma.user.findUnique.mockResolvedValue(await userWithPin());
    const result = await service.login('customer', input, ctx);
    expect(result.mustChangePin).toBe(false);
    expect(sessions.issue).toHaveBeenCalledWith('u1', 'customer', ctx);
    expect(throttle.clear).toHaveBeenCalledWith('login:phone:+237677123456');
    expect(throttle.recordFailure).not.toHaveBeenCalled();
  });

  it('annule une récupération en attente et le signale', async () => {
    const { prisma, recovery, service } = setup();
    prisma.user.findUnique.mockResolvedValue(await userWithPin());
    recovery.cancelOnLogin.mockResolvedValue(true);
    const result = await service.login('staff', input, ctx);
    expect(recovery.cancelOnLogin).toHaveBeenCalledWith('u1');
    expect(result.recoveryCancelled).toBe(true);
  });

  it('n’annule rien quand la connexion échoue', async () => {
    const { prisma, recovery, service } = setup();
    prisma.user.findUnique.mockResolvedValue(await userWithPin());
    await expect(service.login('staff', { ...input, pin: '000001' }, ctx)).rejects.toThrow();
    expect(recovery.cancelOnLogin).not.toHaveBeenCalled();
  });

  it('signale un PIN temporaire à changer', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(await userWithPin('483920', true));
    expect((await service.login('staff', input, ctx)).mustChangePin).toBe(true);
  });

  it('refuse un mauvais PIN, compte l’échec sur le téléphone et l’IP', async () => {
    const { prisma, throttle, sessions, service } = setup();
    prisma.user.findUnique.mockResolvedValue(await userWithPin());
    await expect(service.login('customer', { ...input, pin: '000001' }, ctx)).rejects.toMatchObject(
      {
        status: 401,
        response: { message: 'auth.invalidCredentials' },
      },
    );
    expect(throttle.recordFailure).toHaveBeenCalledWith([
      'login:phone:+237677123456',
      'login:ip:10.0.0.1',
    ]);
    expect(sessions.issue).not.toHaveBeenCalled();
  });

  it('répond pareil pour un numéro inconnu (pas d’énumération)', async () => {
    const { prisma, throttle, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.login('customer', input, ctx)).rejects.toMatchObject({
      status: 401,
      response: { message: 'auth.invalidCredentials' },
    });
    expect(throttle.recordFailure).toHaveBeenCalledOnce();
  });

  it('refuse un compte sans PIN (ex. connexion Google seule)', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(userRow({ credentials: [] }));
    await expect(service.login('customer', input, ctx)).rejects.toMatchObject({ status: 401 });
  });

  it('ne vérifie rien quand le ralentissement bloque', async () => {
    const { prisma, throttle, service } = setup();
    throttle.assertAllowed.mockRejectedValue(Object.assign(new Error('429'), { status: 429 }));
    await expect(service.login('customer', input, ctx)).rejects.toMatchObject({ status: 429 });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('journalise succès et échec', async () => {
    const { prisma, audit, service } = setup();
    prisma.user.findUnique.mockResolvedValue(await userWithPin());
    await service.login('customer', input, ctx);
    await expect(service.login('customer', { ...input, pin: '000001' }, ctx)).rejects.toThrow();
    expect(audit.log.mock.calls.map((c) => c[0].action)).toEqual([
      'auth.login',
      'auth.login.failed',
    ]);
  });
});

describe('AuthService.refresh / logout / me', () => {
  it('refresh délègue à la rotation', async () => {
    const { sessions, service } = setup();
    expect(await service.refresh('staff', 'tok', ctx)).toEqual({ session });
    expect(sessions.rotate).toHaveBeenCalledWith('tok', 'staff', ctx);
  });

  it('logout révoque si un jeton est présenté, sinon ne fait rien', async () => {
    const { sessions, service } = setup();
    await service.logout('tok');
    await service.logout(undefined);
    expect(sessions.revoke).toHaveBeenCalledOnce();
  });

  it('me expose les rôles pour le personnel seulement', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(
      userRow({
        credentials: [{ mustChange: false }],
        memberships: [{ restaurantId: 'r1', role: 'OWNER' }],
      }),
    );
    expect((await service.me('staff', 'u1')).memberships).toEqual([
      { restaurantId: 'r1', role: 'OWNER' },
    ]);
    expect(await service.me('customer', 'u1')).not.toHaveProperty('memberships');
  });

  it('me expose une récupération en attente', async () => {
    const { prisma, recovery, service } = setup();
    prisma.user.findUnique.mockResolvedValue(userRow({ credentials: [], memberships: [] }));
    recovery.pendingFor.mockResolvedValue({ availableAt: new Date('2026-10-19T10:00:00Z') });
    expect((await service.me('staff', 'u1')).recoveryPending).toEqual({
      availableAt: '2026-10-19T10:00:00.000Z',
    });
    recovery.pendingFor.mockResolvedValue(null);
    expect((await service.me('staff', 'u1')).recoveryPending).toBeNull();
  });

  it('me échoue pour un utilisateur supprimé', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.me('staff', 'gone')).rejects.toMatchObject({ status: 401 });
  });
});

describe('AuthService.changePin', () => {
  it('change le PIN, déconnecte les autres appareils et rouvre une session', async () => {
    const { prisma, sessions, service } = setup();
    prisma.credential.findUnique.mockResolvedValue({
      id: 'c1',
      hash: await hasher.hashSecret('483920'),
    });
    await service.changePin('staff', 'u1', '483920', '715204', ctx);
    const data = prisma.credential.update.mock.calls[0]?.[0].data;
    expect(await hasher.verifySecret(data.hash, '715204')).toBe(true);
    expect(data.mustChange).toBe(false);
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith('u1');
    expect(sessions.issue).toHaveBeenCalledWith('u1', 'staff', ctx);
  });

  it('refuse un mauvais PIN actuel et le compte comme échec', async () => {
    const { prisma, throttle, sessions, service } = setup();
    prisma.credential.findUnique.mockResolvedValue({
      id: 'c1',
      hash: await hasher.hashSecret('483920'),
    });
    await expect(service.changePin('staff', 'u1', '111112', '715204', ctx)).rejects.toMatchObject({
      status: 401,
    });
    expect(throttle.recordFailure).toHaveBeenCalledWith(['pin:user:u1']);
    expect(prisma.credential.update).not.toHaveBeenCalled();
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('refuse si le compte n’a pas de PIN', async () => {
    const { prisma, service } = setup();
    prisma.credential.findUnique.mockResolvedValue(null);
    await expect(service.changePin('staff', 'u1', '483920', '715204', ctx)).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('toPublicUser', () => {
  it('expose des booléens, jamais les dates ni les empreintes', () => {
    const view = toPublicUser(
      userRow({ phoneVerifiedAt: new Date(), restrictedUntil: new Date(Date.now() + 60_000) }),
    );
    expect(view).toEqual({
      id: 'u1',
      name: 'Awa Mbarga',
      phone: '+237677123456',
      phoneVerified: true,
      email: null,
      emailVerified: false,
      restricted: true,
    });
  });

  it('une restriction échue ne compte plus', () => {
    expect(toPublicUser(userRow({ restrictedUntil: new Date(Date.now() - 1000) })).restricted).toBe(
      false,
    );
  });
});
