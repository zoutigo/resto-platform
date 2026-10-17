import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { AuditService } from './audit.service.js';
import type { AuthContext } from './auth.service.js';
import { GOOGLE_VERIFIER, type GoogleVerifier } from './google.verifier.js';
import { toPublicUser } from './public-user.js';
import { RecoveryService } from './recovery.service.js';
import { SessionService } from './session.service.js';
import { ThrottleService } from './throttle.service.js';
import type { Audience } from './token.service.js';

const FREE_PER_IP = 30;

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

/** Connexion Google : crée le compte, ou rattache Google à un compte dont l'email est vérifié. */
@Injectable()
export class GoogleAuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(GOOGLE_VERIFIER) private readonly verifier: GoogleVerifier,
    private readonly sessions: SessionService,
    private readonly throttle: ThrottleService,
    private readonly audit: AuditService,
    private readonly recovery: RecoveryService,
  ) {}

  async login(audience: Audience, idToken: string, ctx: AuthContext) {
    const ipKey = `google:ip:${ctx.ip ?? 'unknown'}`;
    await this.throttle.assertAllowed([{ key: ipKey, free: FREE_PER_IP }]);

    let profile;
    try {
      profile = await this.verifier.verify(idToken);
    } catch (e) {
      await this.throttle.recordFailure([ipKey]);
      throw e;
    }
    // Sans email vérifié par Google, on ne peut ni créer ni rattacher en sécurité.
    if (!profile.email || !profile.emailVerified) {
      await this.throttle.recordFailure([ipKey]);
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'google.emailNotVerified',
      });
    }

    let user = await this.prisma.user.findUnique({ where: { googleSub: profile.sub } });
    let created = false;
    if (!user) {
      const sameEmail = await this.prisma.user.findUnique({ where: { email: profile.email } });
      try {
        if (sameEmail) {
          // Son email est déjà vérifié (on ne l'enregistre qu'après preuve) : rattachement sûr.
          user = await this.prisma.user.update({
            where: { id: sameEmail.id },
            data: { googleSub: profile.sub },
          });
          await this.audit.log({ action: 'auth.google.linked', userId: user.id, ip: ctx.ip });
        } else {
          user = await this.prisma.user.create({
            data: {
              name: profile.name,
              email: profile.email,
              emailVerifiedAt: new Date(),
              googleSub: profile.sub,
            },
          });
          created = true;
        }
      } catch (e) {
        // Course : le compte vient d'être créé par une autre requête identique.
        if (!isUniqueViolation(e)) throw e;
        user = await this.prisma.user.findFirst({
          where: { OR: [{ googleSub: profile.sub }, { email: profile.email }] },
        });
        if (!user) throw e;
      }
    }

    await this.audit.log({
      action: created ? 'auth.register.google' : 'auth.login',
      userId: user.id,
      ip: ctx.ip,
      meta: { audience, method: 'google' },
    });
    const recoveryCancelled = await this.recovery.cancelOnLogin(user.id);
    return {
      user: toPublicUser(user),
      isNew: created,
      recoveryCancelled,
      session: await this.sessions.issue(user.id, audience, ctx),
    };
  }
}
