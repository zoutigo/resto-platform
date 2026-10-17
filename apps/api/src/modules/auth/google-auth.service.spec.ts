import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import type { AuditService } from './audit.service.js';
import { GoogleAuthService } from './google-auth.service.js';
import type { GoogleProfile } from './google.verifier.js';
import type { RecoveryService } from './recovery.service.js';
import type { SessionService } from './session.service.js';
import type { ThrottleService } from './throttle.service.js';

const session = {
  userId: 'u1',
  accessToken: 'a',
  expiresIn: 900,
  refreshToken: 'r',
  refreshTtlSeconds: 1,
};
const ctx = { ip: '10.0.0.1' };
const profile: GoogleProfile = {
  sub: 'g-1',
  email: 'awa@gmail.com',
  emailVerified: true,
  name: 'Awa Mbarga',
};

const userRow = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  name: 'Awa Mbarga',
  phone: null,
  phoneVerifiedAt: null,
  email: 'awa@gmail.com',
  emailVerifiedAt: new Date(),
  restrictedUntil: null,
  googleSub: 'g-1',
  ...over,
});

function setup() {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  };
  const verifier = { verify: vi.fn().mockResolvedValue(profile) };
  const sessions = { issue: vi.fn().mockResolvedValue(session) };
  const throttle = {
    assertAllowed: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const recovery = { cancelOnLogin: vi.fn().mockResolvedValue(false) };
  const service = new GoogleAuthService(
    prisma as unknown as PrismaService,
    verifier,
    sessions as unknown as SessionService,
    throttle as unknown as ThrottleService,
    audit as unknown as AuditService,
    recovery as unknown as RecoveryService,
  );
  return { prisma, verifier, sessions, throttle, audit, recovery, service };
}

let c: ReturnType<typeof setup>;
beforeEach(() => {
  c = setup();
});

describe('GoogleAuthService.login', () => {
  it('connecte un compte déjà lié à ce Google', async () => {
    c.prisma.user.findUnique.mockResolvedValueOnce(userRow());
    const result = await c.service.login('customer', 'tok', ctx);
    expect(result.isNew).toBe(false);
    expect(c.prisma.user.create).not.toHaveBeenCalled();
    expect(c.sessions.issue).toHaveBeenCalledWith('u1', 'customer', ctx);
    expect(c.audit.log.mock.calls[0]?.[0].action).toBe('auth.login');
  });

  it('crée un compte avec email vérifié quand rien n’existe', async () => {
    c.prisma.user.findUnique.mockResolvedValue(null);
    c.prisma.user.create.mockResolvedValue(userRow());
    const result = await c.service.login('staff', 'tok', ctx);
    expect(result.isNew).toBe(true);
    const data = c.prisma.user.create.mock.calls[0]?.[0].data;
    expect(data).toMatchObject({ name: 'Awa Mbarga', email: 'awa@gmail.com', googleSub: 'g-1' });
    expect(data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty('credentials');
    expect(c.audit.log.mock.calls[0]?.[0].action).toBe('auth.register.google');
  });

  it('rattache Google à un compte existant dont l’email est vérifié', async () => {
    c.prisma.user.findUnique
      .mockResolvedValueOnce(null) // pas de googleSub
      .mockResolvedValueOnce(userRow({ googleSub: null })); // même email
    c.prisma.user.update.mockResolvedValue(userRow());
    const result = await c.service.login('customer', 'tok', ctx);
    expect(result.isNew).toBe(false);
    expect(c.prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { googleSub: 'g-1' },
    });
    expect(c.prisma.user.create).not.toHaveBeenCalled();
    expect(c.audit.log.mock.calls.map((x) => x[0].action)).toContain('auth.google.linked');
  });

  it.each([
    ['email non vérifié', { emailVerified: false }],
    ['email absent', { email: null }],
  ])('refuse sans email vérifié par Google : %s', async (_l, over) => {
    c.verifier.verify.mockResolvedValue({ ...profile, ...over });
    await expect(c.service.login('customer', 'tok', ctx)).rejects.toMatchObject({
      status: 401,
      response: { message: 'google.emailNotVerified' },
    });
    expect(c.prisma.user.create).not.toHaveBeenCalled();
    expect(c.prisma.user.update).not.toHaveBeenCalled();
    expect(c.throttle.recordFailure).toHaveBeenCalledWith(['google:ip:10.0.0.1']);
  });

  it('refuse un jeton invalide et compte l’échec', async () => {
    c.verifier.verify.mockRejectedValue(Object.assign(new Error('bad'), { status: 401 }));
    await expect(c.service.login('customer', 'tok', ctx)).rejects.toMatchObject({ status: 401 });
    expect(c.throttle.recordFailure).toHaveBeenCalled();
    expect(c.prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('se rabat sur le compte existant quand une requête jumelle l’a créé (course)', async () => {
    c.prisma.user.findUnique.mockResolvedValue(null);
    c.prisma.user.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    c.prisma.user.findFirst.mockResolvedValue(userRow());
    const result = await c.service.login('customer', 'tok', ctx);
    expect(result.isNew).toBe(false);
    expect(c.sessions.issue).toHaveBeenCalledWith('u1', 'customer', ctx);
  });

  it('propage une erreur de base inattendue', async () => {
    c.prisma.user.findUnique.mockResolvedValue(null);
    c.prisma.user.create.mockRejectedValue(new Error('boom'));
    await expect(c.service.login('customer', 'tok', ctx)).rejects.toThrow('boom');
  });

  it('annule une récupération en attente et respecte le ralentissement', async () => {
    c.prisma.user.findUnique.mockResolvedValueOnce(userRow());
    c.recovery.cancelOnLogin.mockResolvedValue(true);
    expect((await c.service.login('staff', 'tok', ctx)).recoveryCancelled).toBe(true);

    c.throttle.assertAllowed.mockRejectedValue(Object.assign(new Error('429'), { status: 429 }));
    await expect(c.service.login('staff', 'tok', ctx)).rejects.toMatchObject({ status: 429 });
  });
});
