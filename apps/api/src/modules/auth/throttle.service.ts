import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';

const WINDOW_MS = 60 * 60 * 1000;
const BASE_DELAY_MS = 30 * 1000;
const MAX_DELAY_MS = 60 * 60 * 1000;

/** `free` : échecs tolérés dans la fenêtre avant le premier délai. */
export interface ThrottleKey {
  key: string;
  free: number;
}

/**
 * Ralentissement progressif (et non blocage dur, qui permettrait de verrouiller le compte
 * d'un autre) : après `free` échecs, 30 s puis 1 min, 2 min… jusqu'à 1 h.
 * Les compteurs vivent en base pour tenir sur plusieurs instances.
 */
@Injectable()
export class ThrottleService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lève 429 avec `Retry-After` si l'une des clés est en délai. */
  async assertAllowed(keys: ThrottleKey[]): Promise<void> {
    const now = Date.now();
    let wait = 0;
    for (const { key, free } of keys) {
      const failures = await this.prisma.authAttempt.findMany({
        where: { key, success: false, createdAt: { gt: new Date(now - WINDOW_MS) } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const excess = failures.length - free;
      if (excess < 0) continue;
      const delay = Math.min(BASE_DELAY_MS * 2 ** excess, MAX_DELAY_MS);
      const last = failures[0]?.createdAt.getTime() ?? now;
      wait = Math.max(wait, last + delay - now);
    }
    if (wait > 0) {
      const retryAfter = Math.ceil(wait / 1000);
      throw new HttpException(
        { statusCode: 429, error: 'TooManyAttempts', message: 'auth.tooManyAttempts', retryAfter },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordFailure(keys: string[]): Promise<void> {
    await this.prisma.authAttempt.createMany({
      data: keys.map((key) => ({ key, success: false })),
    });
    await this.prisma.authAttempt.deleteMany({
      where: { key: { in: keys }, createdAt: { lt: new Date(Date.now() - WINDOW_MS) } },
    });
  }

  /** Une réussite remet à zéro la clé du compte, pas celle de l'IP (sinon l'IP se « blanchit »). */
  async clear(key: string): Promise<void> {
    await this.prisma.authAttempt.deleteMany({ where: { key } });
  }
}
