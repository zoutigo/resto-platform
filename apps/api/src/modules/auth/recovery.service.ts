import {
  type CompleteRecovery,
  RECOVERY_DELAY_HOURS,
  type RecoverWithCode,
  type RecoverWithQuestions,
  normalizeAnswer,
} from '@resto/shared';
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { AuditService } from './audit.service.js';
import { HasherService } from './hasher.service.js';
import { toPublicUser } from './public-user.js';
import { type SessionContext, SessionService } from './session.service.js';
import { ThrottleService } from './throttle.service.js';
import type { Audience } from './token.service.js';

type Ctx = SessionContext;

const RESTRICTED_MODE_HOURS = 48;
/** Une récupération différée doit être finalisée dans les 7 jours suivant son échéance. */
const COMPLETE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const FREE_PER_PHONE = 3;
const FREE_PER_IP = 20;

/** Même réponse pour compte inconnu, secret faux ou politique non satisfaite. */
const failed = () =>
  new UnauthorizedException({
    statusCode: 401,
    error: 'Unauthorized',
    message: 'recovery.failed',
  });

interface Policy {
  minAnswers: number;
  delayHours: number;
}

/**
 * Plus un compte a de pouvoir, plus la récupération par questions est exigeante :
 * propriétaire/gérant : 2 réponses + 48 h ; autre employé : 1 réponse + 24 h ;
 * client : 1 réponse, immédiat (mais compte restreint ensuite).
 */
export function recoveryPolicy(roles: string[]): Policy {
  if (roles.some((r) => r === 'OWNER' || r === 'SUPERVISOR')) {
    return { minAnswers: 2, delayHours: RECOVERY_DELAY_HOURS.managers };
  }
  if (roles.length > 0) return { minAnswers: 1, delayHours: RECOVERY_DELAY_HOURS.otherStaff };
  return { minAnswers: 1, delayHours: RECOVERY_DELAY_HOURS.customer };
}

@Injectable()
export class RecoveryService {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: HasherService,
    private readonly sessions: SessionService,
    private readonly throttle: ThrottleService,
    private readonly audit: AuditService,
  ) {}

  /** Réinitialise le PIN avec le code de secours ; un nouveau code est remis. */
  async recoverWithCode(audience: Audience, input: RecoverWithCode, ctx: Ctx) {
    const keys = this.keys(input.phone, ctx);
    await this.throttle.assertAllowed(keys);

    const user = await this.prisma.user.findUnique({
      where: { phone: input.phone },
      include: { recoveryCodes: { where: { usedAt: null } } },
    });
    const code = this.hasher.normalizeRecoveryCode(input.recoveryCode);
    let matched = false;
    if (user && code && user.recoveryCodes.length > 0) {
      for (const stored of user.recoveryCodes) {
        if (await this.hasher.verifySecret(stored.codeHash, code)) matched = true;
      }
    } else {
      await this.hasher.verifySecret(await this.getDummyHash(), 'dummy');
    }
    if (!user || !matched) return this.fail(keys, 'recovery.code.failed', user?.id, ctx);

    const pinHash = await this.hasher.hashSecret(input.newPin);
    const newCode = this.hasher.generateRecoveryCode();
    const newCodeHash = await this.hasher.hashSecret(
      this.hasher.normalizeRecoveryCode(newCode) ?? newCode,
    );
    await this.prisma.$transaction([
      this.prisma.credential.upsert({
        where: { userId_type: { userId: user.id, type: 'PIN' } },
        update: { hash: pinHash, mustChange: false },
        create: { userId: user.id, type: 'PIN', hash: pinHash },
      }),
      this.prisma.recoveryCode.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.recoveryCode.create({ data: { userId: user.id, codeHash: newCodeHash } }),
      this.prisma.recoveryRequest.updateMany({
        where: { userId: user.id, status: 'PENDING' },
        data: { status: 'CANCELLED', resolvedAt: new Date(), cancelledBy: 'recoveryCode' },
      }),
    ]);
    await this.sessions.revokeAllForUser(user.id);
    await this.throttle.clear(keys[0]!.key);
    await this.audit.log({
      action: 'recovery.code.used',
      userId: user.id,
      ip: ctx.ip,
      meta: { audience },
    });
    const session = await this.sessions.issue(user.id, audience, ctx);
    return { user: toPublicUser(user), recoveryCode: newCode, session };
  }

  /**
   * Récupération par date de naissance + réponses secrètes. Immédiate pour un client
   * (compte restreint 48 h), différée pour un compte ayant un rôle dans un restaurant.
   */
  async recoverWithQuestions(audience: Audience, input: RecoverWithQuestions, ctx: Ctx) {
    const keys = this.keys(input.phone, ctx);
    await this.throttle.assertAllowed(keys);

    const user = await this.prisma.user.findUnique({
      where: { phone: input.phone },
      include: {
        recoveryProfile: { include: { answers: true } },
        memberships: { where: { status: 'ACTIVE' }, select: { role: true } },
      },
    });
    const policy = recoveryPolicy(user?.memberships.map((m) => m.role) ?? []);
    const valid = await this.checkProfile(
      user?.recoveryProfile ?? null,
      input.birthDate,
      input.recoveryAnswers,
      policy.minAnswers,
    );
    if (!user || !valid) return this.fail(keys, 'recovery.questions.failed', user?.id, ctx);

    const pinHash = await this.hasher.hashSecret(input.newPin);
    await this.throttle.clear(keys[0]!.key);

    if (policy.delayHours > 0) {
      const availableAt = new Date(Date.now() + policy.delayHours * HOUR_MS);
      await this.prisma.$transaction([
        this.prisma.recoveryRequest.updateMany({
          where: { userId: user.id, status: 'PENDING' },
          data: { status: 'CANCELLED', resolvedAt: new Date(), cancelledBy: 'superseded' },
        }),
        this.prisma.recoveryRequest.create({
          data: { userId: user.id, newPinHash: pinHash, availableAt, ip: ctx.ip ?? null },
        }),
      ]);
      await this.audit.log({
        action: 'recovery.questions.requested',
        userId: user.id,
        ip: ctx.ip,
        meta: { audience, delayHours: policy.delayHours },
      });
      return { status: 'pending' as const, availableAt };
    }

    const restrictedUntil = new Date(Date.now() + RESTRICTED_MODE_HOURS * HOUR_MS);
    const updated = await this.applyNewPin(user.id, pinHash, { restrictedUntil });
    await this.audit.log({
      action: 'recovery.questions.applied',
      userId: user.id,
      ip: ctx.ip,
      meta: { audience },
    });
    const session = await this.sessions.issue(user.id, audience, ctx);
    return { status: 'completed' as const, user: toPublicUser(updated), session };
  }

  /** Finalise une récupération différée une fois le délai écoulé. */
  async completePending(audience: Audience, input: CompleteRecovery, ctx: Ctx) {
    const keys = this.keys(input.phone, ctx);
    await this.throttle.assertAllowed(keys);

    const user = await this.prisma.user.findUnique({ where: { phone: input.phone } });
    const request = user
      ? await this.prisma.recoveryRequest.findFirst({
          where: {
            userId: user.id,
            status: 'PENDING',
            availableAt: { gt: new Date(Date.now() - COMPLETE_WINDOW_MS) },
          },
          orderBy: { createdAt: 'desc' },
        })
      : null;
    const pinOk = await this.hasher.verifySecret(
      request?.newPinHash ?? (await this.getDummyHash()),
      input.newPin,
    );
    if (!user || !request || !pinOk)
      return this.fail(keys, 'recovery.complete.failed', user?.id, ctx);

    if (request.availableAt.getTime() > Date.now()) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'recovery.notYetAvailable',
        availableAt: request.availableAt.toISOString(),
      });
    }
    const claimed = await this.prisma.recoveryRequest.updateMany({
      where: { id: request.id, status: 'PENDING' },
      data: { status: 'COMPLETED', resolvedAt: new Date() },
    });
    if (claimed.count === 0) return this.fail(keys, 'recovery.complete.failed', user.id, ctx);

    const updated = await this.applyNewPin(user.id, request.newPinHash, {});
    await this.throttle.clear(keys[0]!.key);
    await this.audit.log({
      action: 'recovery.questions.completed',
      userId: user.id,
      ip: ctx.ip,
      meta: { audience },
    });
    const session = await this.sessions.issue(user.id, audience, ctx);
    return { user: toPublicUser(updated), session };
  }

  /** « Ce n'est pas moi » : le titulaire annule toute récupération en attente. */
  async cancelOwn(userId: string): Promise<number> {
    const count = await this.cancelPending(userId, 'owner');
    if (count > 0)
      await this.audit.log({ action: 'recovery.cancelled', userId, meta: { by: 'owner' } });
    return count;
  }

  /** Un gérant annule la récupération en attente d'un employé de son restaurant. */
  async cancelForMember(memberId: string, byUserId: string, restaurantId: string): Promise<number> {
    const count = await this.cancelPending(memberId, 'manager');
    await this.audit.log({
      action: 'recovery.cancelled',
      userId: byUserId,
      restaurantId,
      meta: { by: 'manager', memberId, count },
    });
    return count;
  }

  /** Une connexion réussie avec l'ancien PIN prouve que le titulaire est là. */
  async cancelOnLogin(userId: string): Promise<boolean> {
    const count = await this.cancelPending(userId, 'login');
    if (count > 0)
      await this.audit.log({ action: 'recovery.cancelled', userId, meta: { by: 'login' } });
    return count > 0;
  }

  async pendingFor(userId: string): Promise<{ availableAt: Date } | null> {
    const request = await this.prisma.recoveryRequest.findFirst({
      where: { userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: { availableAt: true },
    });
    return request;
  }

  /** Nouveau code de secours (l'ancien est invalidé), après confirmation du PIN. */
  async regenerateCode(userId: string, pin: string, ctx: Ctx): Promise<{ recoveryCode: string }> {
    const key = `pin:user:${userId}`;
    await this.throttle.assertAllowed([{ key, free: 5 }]);
    const credential = await this.prisma.credential.findUnique({
      where: { userId_type: { userId, type: 'PIN' } },
    });
    if (!credential || !(await this.hasher.verifySecret(credential.hash, pin))) {
      await this.throttle.recordFailure([key]);
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'auth.invalidCredentials',
      });
    }
    await this.throttle.clear(key);
    const recoveryCode = this.hasher.generateRecoveryCode();
    const codeHash = await this.hasher.hashSecret(
      this.hasher.normalizeRecoveryCode(recoveryCode) ?? recoveryCode,
    );
    await this.prisma.$transaction([
      this.prisma.recoveryCode.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.recoveryCode.create({ data: { userId, codeHash } }),
    ]);
    await this.audit.log({ action: 'recovery.code.regenerated', userId, ip: ctx.ip });
    return { recoveryCode };
  }

  private keys(phone: string, ctx: Ctx) {
    return [
      { key: `recover:phone:${phone}`, free: FREE_PER_PHONE },
      { key: `recover:ip:${ctx.ip ?? 'unknown'}`, free: FREE_PER_IP },
    ];
  }

  private async fail(
    keys: { key: string }[],
    action: string,
    userId: string | undefined,
    ctx: Ctx,
  ): Promise<never> {
    await this.throttle.recordFailure(keys.map((k) => k.key));
    await this.audit.log({ action, userId: userId ?? null, ip: ctx.ip });
    throw failed();
  }

  /** Tous les éléments sont vérifiés même après un échec : le temps ne trahit pas la faute. */
  private async checkProfile(
    profile: { birthDateHash: string; answers: { question: string; answerHash: string }[] } | null,
    birthDate: string,
    answers: { question: string; answer: string }[],
    minAnswers: number,
  ): Promise<boolean> {
    if (!profile) {
      await this.hasher.verifySecret(await this.getDummyHash(), 'dummy');
      return false;
    }
    const dateOk = await this.hasher.verifySecret(profile.birthDateHash, birthDate);
    const stored = new Map(profile.answers.map((a) => [a.question, a.answerHash]));
    let matches = 0;
    let invalid = false;
    for (const { question, answer } of answers) {
      const hash = stored.get(question);
      const ok = hash
        ? await this.hasher.verifySecret(hash, normalizeAnswer(answer))
        : (await this.hasher.verifySecret(await this.getDummyHash(), 'dummy'), false);
      if (ok) matches++;
      else invalid = true;
    }
    return dateOk && !invalid && matches >= minAnswers;
  }

  /** Nouveau PIN, sessions coupées, demandes en attente closes. */
  private async applyNewPin(userId: string, pinHash: string, extra: { restrictedUntil?: Date }) {
    const results = await this.prisma.$transaction([
      this.prisma.credential.upsert({
        where: { userId_type: { userId, type: 'PIN' } },
        update: { hash: pinHash, mustChange: false },
        create: { userId, type: 'PIN', hash: pinHash },
      }),
      this.prisma.user.update({ where: { id: userId }, data: extra }),
      this.prisma.recoveryRequest.updateMany({
        where: { userId, status: 'PENDING' },
        data: { status: 'CANCELLED', resolvedAt: new Date(), cancelledBy: 'superseded' },
      }),
    ]);
    await this.sessions.revokeAllForUser(userId);
    return results[1];
  }

  private cancelPending(userId: string, by: string): Promise<number> {
    return this.prisma.recoveryRequest
      .updateMany({
        where: { userId, status: 'PENDING' },
        data: { status: 'CANCELLED', resolvedAt: new Date(), cancelledBy: by },
      })
      .then((r) => r.count);
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hashSecret('dummy');
    return this.dummyHash;
  }
}
