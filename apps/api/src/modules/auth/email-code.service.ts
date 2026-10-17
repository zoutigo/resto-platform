import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { EmailCode, EmailCodePurpose } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma.service.js';
import { EMAIL_CHANNEL, type EmailChannel } from '../notifications/email.channel.js';
import {
  EMAIL_CODE_MINUTES,
  type EmailKind,
  type Locale,
  emailCodeMessage,
} from '../notifications/email-templates.js';
import { HasherService } from './hasher.service.js';
import { ThrottleService } from './throttle.service.js';

const MAX_ATTEMPTS = 5;
const SEND_FREE_PER_EMAIL = 3;
const SEND_FREE_PER_IP = 10;
const VERIFY_FREE_PER_EMAIL = 5;
const VERIFY_FREE_PER_IP = 30;

const KIND: Record<EmailCodePurpose, EmailKind> = {
  REGISTER: 'register',
  ADD_EMAIL: 'addEmail',
  RESET: 'reset',
};

export interface IssueCodeInput {
  purpose: EmailCodePurpose;
  email: string;
  locale: Locale;
  ip?: string | null;
  /** ADD_EMAIL : compte à qui l'adresse sera rattachée */
  userId?: string;
  /** REGISTER : données du futur compte, conservées jusqu'à la vérification */
  registration?: { audience: 'STAFF' | 'CUSTOMER'; name: string; passwordHash: string };
}

/** Une seule réponse pour code faux, expiré, épuisé ou inexistant. */
const invalidCode = () =>
  new BadRequestException({ statusCode: 400, error: 'BadRequest', message: 'emailCode.invalid' });

/** Émission et vérification des codes envoyés par email (6 chiffres, 15 min, 5 essais). */
@Injectable()
export class EmailCodeService {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: HasherService,
    private readonly throttle: ThrottleService,
    @Inject(EMAIL_CHANNEL) private readonly channel: EmailChannel,
  ) {}

  /** Remplace le code précédent du même objet, puis envoie le nouveau. */
  async issue(input: IssueCodeInput): Promise<void> {
    const keys = [
      { key: `email:send:${input.email}`, free: SEND_FREE_PER_EMAIL },
      { key: `email:send:ip:${input.ip ?? 'unknown'}`, free: SEND_FREE_PER_IP },
    ];
    await this.throttle.assertAllowed(keys);
    await this.throttle.recordFailure(keys.map((k) => k.key));

    const code = this.hasher.generateEmailCode();
    const codeHash = await this.hasher.hashSecret(code);
    await this.prisma.$transaction([
      this.prisma.emailCode.deleteMany({
        where: {
          purpose: input.purpose,
          email: input.email,
          ...(input.purpose === 'ADD_EMAIL' ? { userId: input.userId } : {}),
        },
      }),
      this.prisma.emailCode.create({
        data: {
          purpose: input.purpose,
          email: input.email,
          userId: input.userId ?? null,
          codeHash,
          expiresAt: new Date(Date.now() + EMAIL_CODE_MINUTES * 60_000),
          audience: input.registration?.audience ?? null,
          name: input.registration?.name ?? null,
          passwordHash: input.registration?.passwordHash ?? null,
        },
      }),
    ]);
    await this.channel.send({
      to: input.email,
      ...emailCodeMessage(KIND[input.purpose], code, input.locale),
    });
  }

  /**
   * Vérifie le code et le consomme. Le compteur d'essais est incrémenté avant la comparaison
   * (aucun essai « gratuit » en cas de requêtes simultanées) ; au 5e échec le code est mort.
   */
  async verify(input: {
    purpose: EmailCodePurpose;
    email: string;
    code: string;
    ip?: string | null;
    userId?: string;
  }): Promise<EmailCode> {
    const keys = [
      { key: `email:verify:${input.email}`, free: VERIFY_FREE_PER_EMAIL },
      { key: `email:verify:ip:${input.ip ?? 'unknown'}`, free: VERIFY_FREE_PER_IP },
    ];
    await this.throttle.assertAllowed(keys);

    const row = await this.prisma.emailCode.findFirst({
      where: {
        purpose: input.purpose,
        email: input.email,
        consumedAt: null,
        expiresAt: { gt: new Date() },
        ...(input.userId ? { userId: input.userId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    const bumped = row
      ? await this.prisma.emailCode.updateMany({
          where: { id: row.id, consumedAt: null, attempts: { lt: MAX_ATTEMPTS } },
          data: { attempts: { increment: 1 } },
        })
      : { count: 0 };
    const matches = await this.hasher.verifySecret(
      row && bumped.count > 0 ? row.codeHash : await this.getDummyHash(),
      input.code,
    );
    if (!row || bumped.count === 0 || !matches) return this.fail(keys);

    const claimed = await this.prisma.emailCode.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (claimed.count === 0) return this.fail(keys);

    await this.throttle.clear(keys[0]!.key);
    return row;
  }

  private async fail(keys: { key: string }[]): Promise<never> {
    await this.throttle.recordFailure(keys.map((k) => k.key));
    throw invalidCode();
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hashSecret('000000');
    return this.dummyHash;
  }
}
