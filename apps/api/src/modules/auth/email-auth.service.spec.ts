import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import type { AuditService } from './audit.service.js';
import { loadAuthConfig } from './auth.config.js';
import { EmailAuthService } from './email-auth.service.js';
import type { EmailCodeService } from './email-code.service.js';
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
const ctx = { ip: '10.0.0.1' };

const userRow = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  name: 'Awa',
  phone: '+237677123456',
  phoneVerifiedAt: null,
  email: 'awa@gmail.com',
  emailVerifiedAt: new Date(),
  restrictedUntil: null,
  ...over,
});

function setup() {
  const prisma = {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
    emailCode: { findFirst: vi.fn() },
    credential: { upsert: vi.fn().mockResolvedValue({}) },
  };
  const codes = { issue: vi.fn().mockResolvedValue(undefined), verify: vi.fn() };
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
  const recovery = { cancelOnLogin: vi.fn().mockResolvedValue(false) };
  const service = new EmailAuthService(
    prisma as unknown as PrismaService,
    hasher,
    codes as unknown as EmailCodeService,
    sessions as unknown as SessionService,
    throttle as unknown as ThrottleService,
    audit as unknown as AuditService,
    recovery as unknown as RecoveryService,
  );
  return { prisma, codes, sessions, throttle, audit, recovery, service };
}

let c: ReturnType<typeof setup>;
beforeEach(() => {
  c = setup();
});

const registration = {
  name: 'Awa Mbarga',
  email: 'awa@gmail.com',
  password: 'Soleil-2026',
  passwordConfirm: 'Soleil-2026',
  locale: 'fr' as const,
};

describe('startRegistration', () => {
  it('n’enregistre aucun compte : il envoie un code portant les données hachées', async () => {
    c.prisma.user.findUnique.mockResolvedValue(null);
    expect(await c.service.startRegistration('customer', registration, ctx)).toEqual({
      sent: true,
    });
    const issued = c.codes.issue.mock.calls[0]?.[0];
    expect(issued).toMatchObject({ purpose: 'REGISTER', email: 'awa@gmail.com', ip: '10.0.0.1' });
    expect(issued.registration).toMatchObject({ audience: 'CUSTOMER', name: 'Awa Mbarga' });
    expect(await hasher.verifySecret(issued.registration.passwordHash, 'Soleil-2026')).toBe(true);
    expect(JSON.stringify(issued)).not.toContain('Soleil-2026');
    expect(c.prisma.user.create).not.toHaveBeenCalled();
  });

  it('refuse un email déjà rattaché à un compte (409)', async () => {
    c.prisma.user.findUnique.mockResolvedValue(userRow());
    await expect(c.service.startRegistration('staff', registration, ctx)).rejects.toMatchObject({
      status: 409,
      response: { message: 'auth.emailTaken' },
    });
    expect(c.codes.issue).not.toHaveBeenCalled();
  });
});

describe('resendRegistration', () => {
  it('renvoie un code avec les données en attente', async () => {
    c.prisma.emailCode.findFirst.mockResolvedValue({
      name: 'Awa',
      passwordHash: 'h',
      audience: 'CUSTOMER',
    });
    expect(await c.service.resendRegistration('customer', 'awa@gmail.com', 'fr', ctx)).toEqual({
      sent: true,
    });
    expect(c.codes.issue.mock.calls[0]?.[0].registration).toEqual({
      audience: 'CUSTOMER',
      name: 'Awa',
      passwordHash: 'h',
    });
    expect(c.prisma.emailCode.findFirst.mock.calls[0]?.[0].where).toMatchObject({
      audience: 'CUSTOMER',
    });
  });

  it('répond pareil sans inscription en cours, sans rien envoyer', async () => {
    c.prisma.emailCode.findFirst.mockResolvedValue(null);
    expect(await c.service.resendRegistration('customer', 'x@y.cm', 'fr', ctx)).toEqual({
      sent: true,
    });
    expect(c.codes.issue).not.toHaveBeenCalled();
  });
});

describe('completeRegistration', () => {
  const row = { audience: 'CUSTOMER', name: 'Awa', passwordHash: 'hash' };

  it('crée le compte avec email vérifié et mot de passe, puis ouvre la session', async () => {
    c.codes.verify.mockResolvedValue(row);
    c.prisma.user.create.mockResolvedValue(userRow());
    const result = await c.service.completeRegistration(
      'customer',
      { email: 'awa@gmail.com', code: '123456' },
      ctx,
    );
    const data = c.prisma.user.create.mock.calls[0]?.[0].data;
    expect(data).toMatchObject({
      name: 'Awa',
      email: 'awa@gmail.com',
      credentials: { create: { type: 'PASSWORD', hash: 'hash' } },
    });
    expect(data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(result.user.emailVerified).toBe(true);
    expect(c.sessions.issue).toHaveBeenCalledWith('u1', 'customer', ctx);
  });

  it('refuse un code d’inscription de l’autre espace', async () => {
    c.codes.verify.mockResolvedValue({ ...row, audience: 'STAFF' });
    await expect(
      c.service.completeRegistration('customer', { email: 'awa@gmail.com', code: '123456' }, ctx),
    ).rejects.toMatchObject({ status: 400 });
    expect(c.prisma.user.create).not.toHaveBeenCalled();
  });

  it('traduit une course sur l’email en 409', async () => {
    c.codes.verify.mockResolvedValue(row);
    c.prisma.user.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(
      c.service.completeRegistration('customer', { email: 'awa@gmail.com', code: '123456' }, ctx),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('propage l’échec du code', async () => {
    c.codes.verify.mockRejectedValue(Object.assign(new Error('bad'), { status: 400 }));
    await expect(
      c.service.completeRegistration('customer', { email: 'awa@gmail.com', code: '000000' }, ctx),
    ).rejects.toMatchObject({ status: 400 });
    expect(c.prisma.user.create).not.toHaveBeenCalled();
  });
});

describe('login', () => {
  const input = { email: 'awa@gmail.com', password: 'Soleil-2026' };

  async function withPassword() {
    return userRow({ credentials: [{ hash: await hasher.hashSecret('Soleil-2026') }] });
  }

  it('connecte, remet à zéro le compteur et annule une récupération en attente', async () => {
    c.prisma.user.findUnique.mockResolvedValue(await withPassword());
    c.recovery.cancelOnLogin.mockResolvedValue(true);
    const result = await c.service.login('customer', input, ctx);
    expect(result).toMatchObject({ mustChangePin: false, recoveryCancelled: true });
    expect(c.throttle.clear).toHaveBeenCalledWith('login:email:awa@gmail.com');
    expect(c.sessions.issue).toHaveBeenCalledWith('u1', 'customer', ctx);
  });

  it.each([
    ['mauvais mot de passe', async () => withPassword(), { password: 'Autre-mdp-1' }],
    ['email inconnu', async () => null, {}],
    ['compte sans mot de passe (Google, PIN)', async () => userRow({ credentials: [] }), {}],
  ])('401 identique : %s', async (_l, user, over) => {
    c.prisma.user.findUnique.mockResolvedValue(await user());
    await expect(c.service.login('customer', { ...input, ...over }, ctx)).rejects.toMatchObject({
      status: 401,
      response: { message: 'auth.invalidCredentials' },
    });
    expect(c.throttle.recordFailure).toHaveBeenCalledWith([
      'login:email:awa@gmail.com',
      'login:ip:10.0.0.1',
    ]);
    expect(c.sessions.issue).not.toHaveBeenCalled();
    expect(c.recovery.cancelOnLogin).not.toHaveBeenCalled();
  });

  it('respecte le ralentissement', async () => {
    c.throttle.assertAllowed.mockRejectedValue(Object.assign(new Error('429'), { status: 429 }));
    await expect(c.service.login('customer', input, ctx)).rejects.toMatchObject({ status: 429 });
    expect(c.prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('forgot', () => {
  it('envoie un code de réinitialisation à un email connu', async () => {
    c.prisma.user.findUnique.mockResolvedValue(userRow());
    expect(await c.service.forgot('awa@gmail.com', 'fr', ctx)).toEqual({ sent: true });
    expect(c.codes.issue.mock.calls[0]?.[0]).toMatchObject({ purpose: 'RESET', userId: 'u1' });
  });

  it('répond pareil sans rien envoyer pour un email inconnu', async () => {
    c.prisma.user.findUnique.mockResolvedValue(null);
    expect(await c.service.forgot('x@y.cm', 'fr', ctx)).toEqual({ sent: true });
    expect(c.codes.issue).not.toHaveBeenCalled();
  });
});

describe('recoverWithEmail', () => {
  const base = { email: 'awa@gmail.com', code: '123456' };

  it('définit un nouveau mot de passe, coupe les sessions, ouvre une session', async () => {
    c.codes.verify.mockResolvedValue({ userId: 'u1' });
    c.prisma.user.findUnique.mockResolvedValue(userRow());
    await c.service.recoverWithEmail('customer', { ...base, newPassword: 'Nouveau-mdp-9' }, ctx);
    const call = c.prisma.credential.upsert.mock.calls[0]?.[0];
    expect(call.where.userId_type).toEqual({ userId: 'u1', type: 'PASSWORD' });
    expect(await hasher.verifySecret(call.update.hash, 'Nouveau-mdp-9')).toBe(true);
    expect(c.sessions.revokeAllForUser).toHaveBeenCalledWith('u1');
    expect(c.recovery.cancelOnLogin).toHaveBeenCalledWith('u1');
    expect(c.sessions.issue).toHaveBeenCalledWith('u1', 'customer', ctx);
  });

  it('définit un nouveau PIN (compte avec téléphone) sans exiger un changement', async () => {
    c.codes.verify.mockResolvedValue({ userId: 'u1' });
    c.prisma.user.findUnique.mockResolvedValue(userRow());
    await c.service.recoverWithEmail(
      'staff',
      { ...base, newPin: '715204', newPinConfirm: '715204' },
      ctx,
    );
    const call = c.prisma.credential.upsert.mock.calls[0]?.[0];
    expect(call.where.userId_type).toEqual({ userId: 'u1', type: 'PIN' });
    expect(call.update.mustChange).toBe(false);
    expect(await hasher.verifySecret(call.update.hash, '715204')).toBe(true);
  });

  it('refuse un nouveau PIN pour un compte sans téléphone', async () => {
    c.codes.verify.mockResolvedValue({ userId: 'u1' });
    c.prisma.user.findUnique.mockResolvedValue(userRow({ phone: null }));
    await expect(
      c.service.recoverWithEmail(
        'staff',
        { ...base, newPin: '715204', newPinConfirm: '715204' },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 400, response: { message: 'recover.pinNeedsPhone' } });
    expect(c.prisma.credential.upsert).not.toHaveBeenCalled();
  });

  it('refuse un code émis pour un autre compte', async () => {
    c.codes.verify.mockResolvedValue({ userId: 'someone-else' });
    c.prisma.user.findUnique.mockResolvedValue(userRow());
    await expect(
      c.service.recoverWithEmail('customer', { ...base, newPassword: 'Nouveau-mdp-9' }, ctx),
    ).rejects.toMatchObject({
      status: 401,
    });
    expect(c.prisma.credential.upsert).not.toHaveBeenCalled();
    expect(c.sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('propage un code invalide sans rien modifier', async () => {
    c.codes.verify.mockRejectedValue(Object.assign(new Error('bad'), { status: 400 }));
    await expect(
      c.service.recoverWithEmail('customer', { ...base, newPassword: 'Nouveau-mdp-9' }, ctx),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(c.prisma.credential.upsert).not.toHaveBeenCalled();
  });
});

describe('addEmail / confirmEmail', () => {
  it('envoie un code à confirmer pour un compte sans email', async () => {
    c.prisma.user.findUniqueOrThrow.mockResolvedValue(userRow({ email: null }));
    c.prisma.user.findUnique.mockResolvedValue(null);
    expect(await c.service.addEmail('u1', 'awa@gmail.com', 'fr', ctx)).toEqual({ sent: true });
    expect(c.codes.issue.mock.calls[0]?.[0]).toMatchObject({ purpose: 'ADD_EMAIL', userId: 'u1' });
  });

  it('refuse si le compte a déjà un email ou si l’adresse est prise', async () => {
    c.prisma.user.findUniqueOrThrow.mockResolvedValue(userRow());
    c.prisma.user.findUnique.mockResolvedValue(null);
    await expect(c.service.addEmail('u1', 'autre@gmail.com', 'fr', ctx)).rejects.toMatchObject({
      response: { message: 'auth.emailAlreadySet' },
    });
    c.prisma.user.findUniqueOrThrow.mockResolvedValue(userRow({ email: null }));
    c.prisma.user.findUnique.mockResolvedValue(userRow({ id: 'u2' }));
    await expect(c.service.addEmail('u1', 'awa@gmail.com', 'fr', ctx)).rejects.toMatchObject({
      response: { message: 'auth.emailTaken' },
    });
    expect(c.codes.issue).not.toHaveBeenCalled();
  });

  it('confirme : enregistre l’email vérifié', async () => {
    c.codes.verify.mockResolvedValue({});
    c.prisma.user.update.mockResolvedValue(userRow());
    const { user } = await c.service.confirmEmail('u1', '123456', 'awa@gmail.com', ctx);
    expect(c.codes.verify.mock.calls[0]?.[0]).toMatchObject({ purpose: 'ADD_EMAIL', userId: 'u1' });
    expect(c.prisma.user.update.mock.calls[0]?.[0].data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(user.emailVerified).toBe(true);
  });

  it('confirme : course sur l’email → 409', async () => {
    c.codes.verify.mockResolvedValue({});
    c.prisma.user.update.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(
      c.service.confirmEmail('u1', '123456', 'awa@gmail.com', ctx),
    ).rejects.toMatchObject({ status: 409 });
  });
});
