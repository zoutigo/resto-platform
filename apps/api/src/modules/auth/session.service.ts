import { randomUUID } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { AUTH_CONFIG, type AuthConfig } from './auth.config.js';
import { HasherService } from './hasher.service.js';
import { PrismaService } from '../../prisma.service.js';
import { type Audience, TokenService } from './token.service.js';

export interface SessionContext {
  ip?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
}

export interface IssuedSession {
  userId: string;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshTtlSeconds: number;
}

/** Deux onglets qui rafraîchissent en même temps ne doivent pas être pris pour un rejeu. */
const REUSE_GRACE_MS = 10_000;

const AUDIENCE_DB = { staff: 'STAFF', customer: 'CUSTOMER' } as const;

const invalidSession = () =>
  new UnauthorizedException({
    statusCode: 401,
    error: 'Unauthorized',
    message: 'auth.invalidSession',
  });

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: HasherService,
    private readonly tokens: TokenService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  /** Ouvre une session (nouvelle « famille » de refresh tokens). */
  issue(userId: string, audience: Audience, ctx: SessionContext, familyId = randomUUID()) {
    return this.create(userId, audience, ctx, familyId);
  }

  /**
   * Échange un refresh token contre un nouveau couple de jetons. Un jeton déjà échangé qu'on
   * présente à nouveau (hors tolérance) signale un vol : toute la famille est révoquée.
   */
  async rotate(token: string, audience: Audience, ctx: SessionContext): Promise<IssuedSession> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hasher.fingerprint(token) },
    });
    if (!stored || stored.audience !== AUDIENCE_DB[audience] || stored.revokedAt)
      throw invalidSession();
    if (stored.expiresAt.getTime() <= Date.now()) throw invalidSession();

    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      // Relecture : un appel concurrent a pu marquer le jeton entre-temps.
      const fresh = await this.prisma.refreshToken.findUnique({ where: { id: stored.id } });
      const usedAt = fresh?.usedAt?.getTime() ?? 0;
      if (Date.now() - usedAt > REUSE_GRACE_MS) await this.revokeFamily(stored.familyId);
      throw invalidSession();
    }
    return this.create(
      stored.userId,
      audience,
      { ...ctx, deviceId: stored.deviceId },
      stored.familyId,
    );
  }

  /** Déconnexion : révoque la famille du jeton présenté (silencieux s'il est inconnu). */
  async revoke(token: string): Promise<void> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hasher.fingerprint(token) },
    });
    if (stored) await this.revokeFamily(stored.familyId);
  }

  /** Déconnecte tous les appareils d'un utilisateur (changement de PIN, récupération). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private revokeFamily(familyId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async create(
    userId: string,
    audience: Audience,
    ctx: SessionContext,
    familyId: string,
  ): Promise<IssuedSession> {
    const refreshToken = this.tokens.generateRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        audience: AUDIENCE_DB[audience],
        familyId,
        tokenHash: this.hasher.fingerprint(refreshToken),
        deviceId: ctx.deviceId ?? null,
        userAgent: ctx.userAgent?.slice(0, 255) ?? null,
        expiresAt: new Date(Date.now() + this.config.refreshTtlSeconds * 1000),
      },
    });
    return {
      userId,
      accessToken: await this.tokens.signAccess({ userId, audience }),
      expiresIn: this.config.accessTtlSeconds,
      refreshToken,
      refreshTtlSeconds: this.config.refreshTtlSeconds,
    };
  }
}
