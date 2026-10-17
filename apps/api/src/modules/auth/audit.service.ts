import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma.service.js';

export interface AuditEntry {
  action: string;
  userId?: string | null;
  restaurantId?: string | null;
  meta?: Prisma.InputJsonValue;
  ip?: string | null;
}

/** Journal d'audit des actions sensibles (connexions, changements de PIN, récupérations). */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        action: entry.action,
        userId: entry.userId ?? null,
        restaurantId: entry.restaurantId ?? null,
        meta: entry.meta ?? undefined,
        ip: entry.ip ?? null,
      },
    });
  }
}
