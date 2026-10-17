import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import { AccountService } from './account.service.js';
import type { AuditService } from './audit.service.js';

const userRow = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  name: 'Awa',
  phone: null,
  phoneVerifiedAt: null,
  email: 'awa@gmail.com',
  emailVerifiedAt: new Date(),
  restrictedUntil: null,
  ...over,
});

let prisma: { user: Record<string, ReturnType<typeof vi.fn>> };
let audit: { log: ReturnType<typeof vi.fn> };
let service: AccountService;

beforeEach(() => {
  prisma = { user: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(), update: vi.fn() } };
  audit = { log: vi.fn().mockResolvedValue(undefined) };
  service = new AccountService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
});

describe('AccountService.addPhone', () => {
  it('rattache un numéro non vérifié', async () => {
    prisma.user.findUniqueOrThrow!.mockResolvedValue(userRow());
    prisma.user.findUnique!.mockResolvedValue(null);
    prisma.user.update!.mockResolvedValue(userRow({ phone: '+237677123456' }));
    const { user } = await service.addPhone('u1', '+237677123456', { ip: '1.1.1.1' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { phone: '+237677123456' },
    });
    expect(user).toMatchObject({ phone: '+237677123456', phoneVerified: false });
    expect(audit.log).toHaveBeenCalledOnce();
  });

  it('refuse si le compte a déjà un numéro', async () => {
    prisma.user.findUniqueOrThrow!.mockResolvedValue(userRow({ phone: '+237677000000' }));
    await expect(service.addPhone('u1', '+237677123456', {})).rejects.toMatchObject({
      status: 409,
      response: { message: 'auth.phoneAlreadySet' },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuse un numéro déjà pris, y compris par course', async () => {
    prisma.user.findUniqueOrThrow!.mockResolvedValue(userRow());
    prisma.user.findUnique!.mockResolvedValue(userRow({ id: 'u2' }));
    await expect(service.addPhone('u1', '+237677123456', {})).rejects.toMatchObject({
      response: { message: 'auth.phoneTaken' },
    });
    prisma.user.findUnique!.mockResolvedValue(null);
    prisma.user.update!.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(service.addPhone('u1', '+237677123456', {})).rejects.toMatchObject({
      status: 409,
    });
  });

  it('laisse remonter une autre erreur', async () => {
    prisma.user.findUniqueOrThrow!.mockResolvedValue(userRow());
    prisma.user.findUnique!.mockResolvedValue(null);
    prisma.user.update!.mockRejectedValue(new Error('boom'));
    await expect(service.addPhone('u1', '+237677123456', {})).rejects.toThrow('boom');
  });
});
