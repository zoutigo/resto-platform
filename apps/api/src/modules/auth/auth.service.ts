import {
  type LoginPhone,
  type RegisterCustomer,
  type RegisterOwner,
  normalizeAnswer,
} from '@resto/shared';
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { AuditService } from './audit.service.js';
import { toPublicUser } from './public-user.js';
import { HasherService } from './hasher.service.js';
import { RecoveryService } from './recovery.service.js';
import { type IssuedSession, type SessionContext, SessionService } from './session.service.js';
import { ThrottleService } from './throttle.service.js';
import type { Audience } from './token.service.js';

export interface AuthContext extends SessionContext {
  ip?: string | null;
}

type RegisterInput = RegisterCustomer | RegisterOwner;

const LOGIN_FREE_PER_PHONE = 5;
// Beaucoup d'abonnés mobiles partagent une même IP (CGNAT) : seuil large par IP.
const LOGIN_FREE_PER_IP = 30;
const REGISTER_FREE_PER_IP = 10;

const invalidCredentials = () =>
  new UnauthorizedException({
    statusCode: 401,
    error: 'Unauthorized',
    message: 'auth.invalidCredentials',
  });

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

@Injectable()
export class AuthService {
  // Hachage factice pour garder un temps de réponse constant quand le numéro est inconnu.
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: HasherService,
    private readonly sessions: SessionService,
    private readonly throttle: ThrottleService,
    private readonly audit: AuditService,
    private readonly recovery: RecoveryService,
  ) {}

  async register(audience: Audience, input: RegisterInput, ctx: AuthContext) {
    const ipKey = `register:ip:${ctx.ip ?? 'unknown'}`;
    await this.throttle.assertAllowed([{ key: ipKey, free: REGISTER_FREE_PER_IP }]);
    await this.throttle.recordFailure([ipKey]);

    const existing = await this.prisma.user.findUnique({ where: { phone: input.phone } });
    if (existing) throw this.phoneTaken();

    const name = 'name' in input ? input.name : `${input.firstName} ${input.lastName}`;
    const recoveryCode = this.hasher.generateRecoveryCode();
    const [pinHash, birthDateHash, codeHash, answers] = await Promise.all([
      this.hasher.hashSecret(input.pin),
      this.hasher.hashRecoveryValue(input.birthDate),
      this.hasher.hashSecret(this.hasher.normalizeRecoveryCode(recoveryCode) ?? recoveryCode),
      Promise.all(
        input.recoveryAnswers.map(async (a) => ({
          question: a.question,
          answerHash: await this.hasher.hashRecoveryValue(normalizeAnswer(a.answer)),
        })),
      ),
    ]);

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          name,
          phone: input.phone,
          credentials: { create: { type: 'PIN', hash: pinHash } },
          recoveryProfile: { create: { birthDateHash, answers: { create: answers } } },
          recoveryCodes: { create: { codeHash } },
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw this.phoneTaken();
      throw e;
    }

    await this.audit.log({
      action: 'auth.register',
      userId: user.id,
      ip: ctx.ip,
      meta: { audience },
    });
    const session = await this.sessions.issue(user.id, audience, ctx);
    return { user: toPublicUser(user), recoveryCode, session };
  }

  async login(audience: Audience, input: LoginPhone, ctx: AuthContext) {
    const phoneKey = `login:phone:${input.phone}`;
    const ipKey = `login:ip:${ctx.ip ?? 'unknown'}`;
    await this.throttle.assertAllowed([
      { key: phoneKey, free: LOGIN_FREE_PER_PHONE },
      { key: ipKey, free: LOGIN_FREE_PER_IP },
    ]);

    const user = await this.prisma.user.findUnique({
      where: { phone: input.phone },
      include: { credentials: { where: { type: 'PIN' } } },
    });
    const credential = user?.credentials[0];
    const valid = await this.hasher.verifySecret(
      credential?.hash ?? (await this.getDummyHash()),
      input.pin,
    );

    if (!user || !credential || !valid) {
      await this.throttle.recordFailure([phoneKey, ipKey]);
      await this.audit.log({
        action: 'auth.login.failed',
        userId: user?.id ?? null,
        ip: ctx.ip,
        meta: { audience },
      });
      throw invalidCredentials();
    }

    await this.throttle.clear(phoneKey);
    await this.audit.log({ action: 'auth.login', userId: user.id, ip: ctx.ip, meta: { audience } });
    // Se connecter avec l'ancien PIN prouve que le titulaire est là : toute récupération en attente tombe.
    const recoveryCancelled = await this.recovery.cancelOnLogin(user.id);
    const session = await this.sessions.issue(user.id, audience, ctx);
    return {
      user: toPublicUser(user),
      mustChangePin: credential.mustChange,
      recoveryCancelled,
      session,
    };
  }

  async refresh(audience: Audience, token: string, ctx: AuthContext) {
    const session = await this.sessions.rotate(token, audience, ctx);
    return { session };
  }

  logout(token: string | undefined): Promise<void> {
    return token ? this.sessions.revoke(token) : Promise.resolve();
  }

  async me(audience: Audience, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        credentials: { where: { type: 'PIN' }, select: { mustChange: true } },
        memberships: {
          where: { status: 'ACTIVE' },
          select: { restaurantId: true, role: true },
        },
      },
    });
    if (!user) throw invalidCredentials();
    const pending = await this.recovery.pendingFor(userId);
    return {
      user: toPublicUser(user),
      mustChangePin: user.credentials[0]?.mustChange ?? false,
      recoveryPending: pending ? { availableAt: pending.availableAt.toISOString() } : null,
      ...(audience === 'staff' ? { memberships: user.memberships } : {}),
    };
  }

  /** Changement de PIN connecté : exige l'ancien, déconnecte les autres appareils. */
  async changePin(
    audience: Audience,
    userId: string,
    currentPin: string,
    newPin: string,
    ctx: AuthContext,
  ): Promise<{ session: IssuedSession }> {
    const phoneKey = `pin:user:${userId}`;
    await this.throttle.assertAllowed([{ key: phoneKey, free: LOGIN_FREE_PER_PHONE }]);
    const credential = await this.prisma.credential.findUnique({
      where: { userId_type: { userId, type: 'PIN' } },
    });
    if (!credential || !(await this.hasher.verifySecret(credential.hash, currentPin))) {
      await this.throttle.recordFailure([phoneKey]);
      throw invalidCredentials();
    }
    await this.throttle.clear(phoneKey);
    await this.prisma.credential.update({
      where: { id: credential.id },
      data: { hash: await this.hasher.hashSecret(newPin), mustChange: false },
    });
    await this.sessions.revokeAllForUser(userId);
    await this.audit.log({ action: 'auth.pin.changed', userId, ip: ctx.ip });
    return { session: await this.sessions.issue(userId, audience, ctx) };
  }

  private phoneTaken() {
    return new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: 'auth.phoneTaken',
    });
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hashSecret('000000');
    return this.dummyHash;
  }
}
