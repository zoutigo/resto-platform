import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { AuditService } from './audit.service.js';
import type { AuthContext } from './auth.service.js';
import { toPublicUser } from './public-user.js';

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

const conflict = (message: string) =>
  new ConflictException({ statusCode: 409, error: 'Conflict', message });

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Rattache un numéro (non vérifié) à un compte email/Google, nécessaire pour commander.
   * Un numéro déjà utilisé par un autre compte est refusé ; un compte qui a déjà un numéro
   * ne peut pas le remplacer ainsi (le numéro sert d'identifiant de connexion).
   */
  async addPhone(userId: string, phone: string, ctx: AuthContext) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.phone) throw conflict('auth.phoneAlreadySet');
    if (await this.prisma.user.findUnique({ where: { phone } })) throw conflict('auth.phoneTaken');
    try {
      const updated = await this.prisma.user.update({ where: { id: userId }, data: { phone } });
      await this.audit.log({ action: 'auth.phone.added', userId, ip: ctx.ip });
      return { user: toPublicUser(updated) };
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('auth.phoneTaken');
      throw e;
    }
  }
}
