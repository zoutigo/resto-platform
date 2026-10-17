import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import { MemoryEmailChannel } from '../notifications/email.channel.js';
import { loadAuthConfig } from './auth.config.js';
import { EmailCodeService } from './email-code.service.js';
import { HasherService } from './hasher.service.js';
import type { ThrottleService } from './throttle.service.js';

const NOW = new Date('2026-10-17T10:00:00Z');
const hasher = new HasherService(loadAuthConfig());

function setup() {
  const emailCode = {
    deleteMany: vi.fn().mockReturnValue('deleteMany'),
    create: vi.fn().mockReturnValue('create'),
    findFirst: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma = {
    emailCode,
    $transaction: vi.fn().mockResolvedValue([]),
  };
  const throttle = {
    assertAllowed: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  };
  const channel = new MemoryEmailChannel();
  const service = new EmailCodeService(
    prisma as unknown as PrismaService,
    hasher,
    throttle as unknown as ThrottleService,
    channel,
  );
  return { emailCode, prisma, throttle, channel, service };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('EmailCodeService.issue', () => {
  it('envoie un code à 6 chiffres, ne stocke que son empreinte, expire dans 15 min', async () => {
    const c = setup();
    await c.service.issue({
      purpose: 'RESET',
      email: 'a@b.cm',
      locale: 'fr',
      ip: '1.1.1.1',
      userId: 'u1',
    });

    const code = c.channel.lastCodeTo('a@b.cm');
    expect(code).toMatch(/^\d{6}$/);
    const data = c.emailCode.create.mock.calls[0]?.[0].data;
    expect(data).toMatchObject({ purpose: 'RESET', email: 'a@b.cm', userId: 'u1' });
    expect(data.expiresAt).toEqual(new Date(NOW.getTime() + 15 * 60_000));
    expect(await hasher.verifySecret(data.codeHash, code!)).toBe(true);
    expect(JSON.stringify(data)).not.toContain(code!);
    expect(c.channel.lastTo('a@b.cm')?.subject).toBe('Réinitialisation de votre accès');
  });

  it('remplace le code précédent de la même demande (transaction)', async () => {
    const c = setup();
    await c.service.issue({ purpose: 'REGISTER', email: 'a@b.cm', locale: 'en' });
    expect(c.emailCode.deleteMany.mock.calls[0]?.[0].where).toEqual({
      purpose: 'REGISTER',
      email: 'a@b.cm',
    });
    expect(c.prisma.$transaction).toHaveBeenCalledWith(['deleteMany', 'create']);
    expect(c.channel.lastTo('a@b.cm')?.subject).toBe('Your verification code');
  });

  it('pour ADD_EMAIL, ne remplace que le code du même compte', async () => {
    const c = setup();
    await c.service.issue({ purpose: 'ADD_EMAIL', email: 'a@b.cm', locale: 'fr', userId: 'u1' });
    expect(c.emailCode.deleteMany.mock.calls[0]?.[0].where).toEqual({
      purpose: 'ADD_EMAIL',
      email: 'a@b.cm',
      userId: 'u1',
    });
  });

  it('conserve les données d’inscription dans le code', async () => {
    const c = setup();
    await c.service.issue({
      purpose: 'REGISTER',
      email: 'a@b.cm',
      locale: 'fr',
      registration: { audience: 'CUSTOMER', name: 'Awa', passwordHash: 'h' },
    });
    expect(c.emailCode.create.mock.calls[0]?.[0].data).toMatchObject({
      audience: 'CUSTOMER',
      name: 'Awa',
      passwordHash: 'h',
    });
  });

  it('limite les envois par adresse et par IP, avant tout envoi', async () => {
    const c = setup();
    c.throttle.assertAllowed.mockRejectedValue(Object.assign(new Error('429'), { status: 429 }));
    await expect(
      c.service.issue({ purpose: 'RESET', email: 'a@b.cm', locale: 'fr', ip: '9.9.9.9' }),
    ).rejects.toMatchObject({ status: 429 });
    expect(c.channel.sent).toHaveLength(0);
    expect(c.throttle.assertAllowed.mock.calls[0]?.[0]).toEqual([
      { key: 'email:send:a@b.cm', free: 3 },
      { key: 'email:send:ip:9.9.9.9', free: 10 },
    ]);
  });
});

describe('EmailCodeService.verify', () => {
  const base = { purpose: 'RESET' as const, email: 'a@b.cm', code: '123456' };

  async function row(over: Record<string, unknown> = {}) {
    return {
      id: 'e1',
      userId: 'u1',
      codeHash: await hasher.hashSecret('123456'),
      attempts: 0,
      ...over,
    };
  }

  it('accepte le bon code et le consomme', async () => {
    const c = setup();
    c.emailCode.findFirst.mockResolvedValue(await row());
    const result = await c.service.verify(base);
    expect(result.id).toBe('e1');
    expect(c.emailCode.updateMany.mock.calls[1]?.[0]).toEqual({
      where: { id: 'e1', consumedAt: null },
      data: { consumedAt: NOW },
    });
    expect(c.throttle.clear).toHaveBeenCalledWith('email:verify:a@b.cm');
  });

  it('ne cherche que les codes non consommés et non expirés', async () => {
    const c = setup();
    c.emailCode.findFirst.mockResolvedValue(await row());
    await c.service.verify({ ...base, userId: 'u1' });
    expect(c.emailCode.findFirst.mock.calls[0]?.[0].where).toEqual({
      purpose: 'RESET',
      email: 'a@b.cm',
      consumedAt: null,
      expiresAt: { gt: NOW },
      userId: 'u1',
    });
  });

  it('incrémente le compteur d’essais avant de comparer, plafonné à 5', async () => {
    const c = setup();
    c.emailCode.findFirst.mockResolvedValue(await row());
    await c.service.verify(base);
    expect(c.emailCode.updateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: 'e1', consumedAt: null, attempts: { lt: 5 } },
      data: { attempts: { increment: 1 } },
    });
  });

  it('refuse un mauvais code (400 générique) et compte l’échec', async () => {
    const c = setup();
    c.emailCode.findFirst.mockResolvedValue(await row());
    await expect(c.service.verify({ ...base, code: '000000' })).rejects.toMatchObject({
      status: 400,
      response: { message: 'emailCode.invalid' },
    });
    expect(c.throttle.recordFailure).toHaveBeenCalledWith([
      'email:verify:a@b.cm',
      'email:verify:ip:unknown',
    ]);
    expect(c.emailCode.updateMany).toHaveBeenCalledOnce(); // pas de consommation
  });

  it('refuse quand les 5 essais sont épuisés, même avec le bon code', async () => {
    const c = setup();
    c.emailCode.findFirst.mockResolvedValue(await row({ attempts: 5 }));
    c.emailCode.updateMany.mockResolvedValue({ count: 0 });
    await expect(c.service.verify(base)).rejects.toMatchObject({
      response: { message: 'emailCode.invalid' },
    });
  });

  it('refuse quand aucun code actif n’existe (même réponse)', async () => {
    const c = setup();
    c.emailCode.findFirst.mockResolvedValue(null);
    await expect(c.service.verify(base)).rejects.toMatchObject({
      status: 400,
      response: { message: 'emailCode.invalid' },
    });
    expect(c.emailCode.updateMany).not.toHaveBeenCalled();
  });

  it('refuse si le code a été consommé entre-temps (course)', async () => {
    const c = setup();
    c.emailCode.findFirst.mockResolvedValue(await row());
    c.emailCode.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(c.service.verify(base)).rejects.toMatchObject({ status: 400 });
    expect(c.throttle.clear).not.toHaveBeenCalled();
  });

  it('respecte le ralentissement avant toute lecture', async () => {
    const c = setup();
    c.throttle.assertAllowed.mockRejectedValue(Object.assign(new Error('429'), { status: 429 }));
    await expect(c.service.verify(base)).rejects.toMatchObject({ status: 429 });
    expect(c.emailCode.findFirst).not.toHaveBeenCalled();
  });
});
