import type { LoginEmailInput, RecoverEmail, RegisterEmail } from '@resto/shared';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Locale } from '../notifications/email-templates.js';
import { PrismaService } from '../../prisma.service.js';
import { AuditService } from './audit.service.js';
import type { AuthContext } from './auth.service.js';
import { EmailCodeService } from './email-code.service.js';
import { HasherService } from './hasher.service.js';
import { toPublicUser } from './public-user.js';
import { RecoveryService } from './recovery.service.js';
import { SessionService } from './session.service.js';
import { ThrottleService } from './throttle.service.js';
import type { Audience } from './token.service.js';

const LOGIN_FREE_PER_EMAIL = 5;
const LOGIN_FREE_PER_IP = 30;
const AUDIENCE_DB = { staff: 'STAFF', customer: 'CUSTOMER' } as const;

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

const invalidCredentials = () =>
  new UnauthorizedException({
    statusCode: 401,
    error: 'Unauthorized',
    message: 'auth.invalidCredentials',
  });

const emailTaken = () =>
  new ConflictException({ statusCode: 409, error: 'Conflict', message: 'auth.emailTaken' });

/** Inscription, connexion et récupération par email (code à 6 chiffres + mot de passe). */
@Injectable()
export class EmailAuthService {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: HasherService,
    private readonly codes: EmailCodeService,
    private readonly sessions: SessionService,
    private readonly throttle: ThrottleService,
    private readonly audit: AuditService,
    private readonly recovery: RecoveryService,
  ) {}

  /** Étape 1 : aucun compte n'est créé ; les données attendent la preuve de possession de l'email. */
  async startRegistration(audience: Audience, input: RegisterEmail, ctx: AuthContext) {
    if (await this.prisma.user.findUnique({ where: { email: input.email } })) throw emailTaken();
    await this.codes.issue({
      purpose: 'REGISTER',
      email: input.email,
      locale: input.locale,
      ip: ctx.ip,
      registration: {
        audience: AUDIENCE_DB[audience],
        name: input.name,
        passwordHash: await this.hasher.hashSecret(input.password),
      },
    });
    return { sent: true as const };
  }

  /** Renvoie un code pour une inscription en cours ; même réponse qu'il y en ait une ou non. */
  async resendRegistration(audience: Audience, email: string, locale: Locale, ctx: AuthContext) {
    const pending = await this.prisma.emailCode.findFirst({
      where: { purpose: 'REGISTER', email, audience: AUDIENCE_DB[audience], consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (pending?.name && pending.passwordHash && pending.audience) {
      await this.codes.issue({
        purpose: 'REGISTER',
        email,
        locale,
        ip: ctx.ip,
        registration: {
          audience: pending.audience,
          name: pending.name,
          passwordHash: pending.passwordHash,
        },
      });
    }
    return { sent: true as const };
  }

  /** Étape 2 : le code saisi crée le compte (email vérifié) et ouvre la session. */
  async completeRegistration(
    audience: Audience,
    input: { email: string; code: string },
    ctx: AuthContext,
  ) {
    const row = await this.codes.verify({
      purpose: 'REGISTER',
      email: input.email,
      code: input.code,
      ip: ctx.ip,
    });
    if (row.audience !== AUDIENCE_DB[audience] || !row.name || !row.passwordHash) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'BadRequest',
        message: 'emailCode.invalid',
      });
    }
    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          name: row.name,
          email: input.email,
          emailVerifiedAt: new Date(),
          credentials: { create: { type: 'PASSWORD', hash: row.passwordHash } },
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw emailTaken();
      throw e;
    }
    await this.audit.log({
      action: 'auth.register.email',
      userId: user.id,
      ip: ctx.ip,
      meta: { audience },
    });
    return { user: toPublicUser(user), session: await this.sessions.issue(user.id, audience, ctx) };
  }

  async login(audience: Audience, input: LoginEmailInput & { email: string }, ctx: AuthContext) {
    const emailKey = `login:email:${input.email}`;
    const ipKey = `login:ip:${ctx.ip ?? 'unknown'}`;
    await this.throttle.assertAllowed([
      { key: emailKey, free: LOGIN_FREE_PER_EMAIL },
      { key: ipKey, free: LOGIN_FREE_PER_IP },
    ]);

    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { credentials: { where: { type: 'PASSWORD' } } },
    });
    const credential = user?.credentials[0];
    const valid = await this.hasher.verifySecret(
      credential?.hash ?? (await this.getDummyHash()),
      input.password,
    );
    if (!user || !credential || !valid) {
      await this.throttle.recordFailure([emailKey, ipKey]);
      await this.audit.log({
        action: 'auth.login.failed',
        userId: user?.id ?? null,
        ip: ctx.ip,
        meta: { audience, method: 'email' },
      });
      throw invalidCredentials();
    }

    await this.throttle.clear(emailKey);
    await this.audit.log({
      action: 'auth.login',
      userId: user.id,
      ip: ctx.ip,
      meta: { audience, method: 'email' },
    });
    const recoveryCancelled = await this.recovery.cancelOnLogin(user.id);
    return {
      user: toPublicUser(user),
      mustChangePin: false,
      recoveryCancelled,
      session: await this.sessions.issue(user.id, audience, ctx),
    };
  }

  /** « Mot de passe / PIN oublié » : réponse identique que l'adresse existe ou non. */
  async forgot(email: string, locale: Locale, ctx: AuthContext) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user) {
      await this.codes.issue({ purpose: 'RESET', email, locale, ip: ctx.ip, userId: user.id });
    }
    return { sent: true as const };
  }

  /** Le code reçu autorise un nouveau mot de passe ou un nouveau PIN. */
  async recoverWithEmail(audience: Audience, input: RecoverEmail, ctx: AuthContext) {
    const row = await this.codes.verify({
      purpose: 'RESET',
      email: input.email,
      code: input.code,
      ip: ctx.ip,
    });
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user || row.userId !== user.id) throw invalidCredentials();

    if (input.newPin !== undefined) {
      if (!user.phone) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'BadRequest',
          message: 'recover.pinNeedsPhone',
        });
      }
      const hash = await this.hasher.hashSecret(input.newPin);
      await this.prisma.credential.upsert({
        where: { userId_type: { userId: user.id, type: 'PIN' } },
        update: { hash, mustChange: false },
        create: { userId: user.id, type: 'PIN', hash },
      });
    } else if (input.newPassword !== undefined) {
      const hash = await this.hasher.hashSecret(input.newPassword);
      await this.prisma.credential.upsert({
        where: { userId_type: { userId: user.id, type: 'PASSWORD' } },
        update: { hash },
        create: { userId: user.id, type: 'PASSWORD', hash },
      });
    }
    await this.sessions.revokeAllForUser(user.id);
    await this.recovery.cancelOnLogin(user.id);
    await this.audit.log({
      action: 'recovery.email.used',
      userId: user.id,
      ip: ctx.ip,
      meta: { audience, target: input.newPin !== undefined ? 'pin' : 'password' },
    });
    return { user: toPublicUser(user), session: await this.sessions.issue(user.id, audience, ctx) };
  }

  /** Rattache un email à un compte connecté (envoie un code à confirmer). */
  async addEmail(userId: string, email: string, locale: Locale, ctx: AuthContext) {
    const [user, taken] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.prisma.user.findUnique({ where: { email } }),
    ]);
    if (user.email) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'auth.emailAlreadySet',
      });
    }
    if (taken) throw emailTaken();
    await this.codes.issue({ purpose: 'ADD_EMAIL', email, locale, ip: ctx.ip, userId });
    return { sent: true as const };
  }

  async confirmEmail(userId: string, code: string, email: string, ctx: AuthContext) {
    await this.codes.verify({ purpose: 'ADD_EMAIL', email, code, ip: ctx.ip, userId });
    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: { email, emailVerifiedAt: new Date() },
      });
      await this.audit.log({ action: 'auth.email.added', userId, ip: ctx.ip });
      return { user: toPublicUser(user) };
    } catch (e) {
      if (isUniqueViolation(e)) throw emailTaken();
      throw e;
    }
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hashSecret('dummy-password');
    return this.dummyHash;
  }
}
