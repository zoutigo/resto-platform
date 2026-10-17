import {
  type LoginPhone,
  changePinSchema,
  completeRecoverySchema,
  loginPhoneSchema,
  recoverWithCodeSchema,
  recoverWithQuestionsSchema,
  regenerateRecoveryCodeSchema,
  registerCustomerSchema,
  registerOwnerSchema,
} from '@resto/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { parseOrThrow } from '../../common/zod-validation.pipe.js';
import { AudiencePipe } from './audience.pipe.js';
import { AUTH_CONFIG, type AuthConfig } from './auth.config.js';
import { AllowMustChangePin, Authenticated, CurrentAuth } from './auth.guard.js';
import { type AuthContext, AuthService } from './auth.service.js';
import { RecoveryService } from './recovery.service.js';
import type { IssuedSession } from './session.service.js';
import type { AccessClaims, Audience } from './token.service.js';

const NATIVE_HEADER = 'x-client';

const cookieName = (audience: Audience) => `resto_${audience}_rt`;
const isNative = (req: Request) => req.headers[NATIVE_HEADER] === 'native';

const contextOf = (req: Request): AuthContext => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  deviceId: typeof req.headers['x-device-id'] === 'string' ? req.headers['x-device-id'] : null,
});

/**
 * Authentification des deux sites : `/auth/staff/*` (back-office) et `/auth/customer/*`
 * (vitrine). Web : le refresh token voyage dans un cookie httpOnly. Mobile natif
 * (en-tête `x-client: native`) : il est renvoyé dans le corps et reçu dans le corps.
 */
@Controller('auth/:audience')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly recovery: RecoveryService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Post('register')
  async register(
    @Param('audience', AudiencePipe) audience: Audience,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parseOrThrow(
      audience === 'staff' ? registerOwnerSchema : registerCustomerSchema,
      body,
    );
    const { user, recoveryCode, session } = await this.auth.register(
      audience,
      input,
      contextOf(req),
    );
    return { user, recoveryCode, ...this.deliver(audience, req, res, session) };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Param('audience', AudiencePipe) audience: Audience,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input: LoginPhone = parseOrThrow(loginPhoneSchema, body);
    const { user, mustChangePin, recoveryCancelled, session } = await this.auth.login(
      audience,
      input,
      contextOf(req),
    );
    return { user, mustChangePin, recoveryCancelled, ...this.deliver(audience, req, res, session) };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Param('audience', AudiencePipe) audience: Audience,
    @Body() body: { refreshToken?: string } | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = this.readRefreshToken(audience, req, body);
    if (!token) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'auth.invalidSession',
      });
    }
    const { session } = await this.auth.refresh(audience, token, contextOf(req));
    return this.deliver(audience, req, res, session);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Param('audience', AudiencePipe) audience: Audience,
    @Body() body: { refreshToken?: string } | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(this.readRefreshToken(audience, req, body));
    res.clearCookie(cookieName(audience), this.cookieOptions(audience));
  }

  @Get('me')
  @Authenticated()
  @AllowMustChangePin()
  me(@Param('audience', AudiencePipe) audience: Audience, @CurrentAuth() claims: AccessClaims) {
    return this.auth.me(audience, claims.userId);
  }

  @Post('pin')
  @HttpCode(200)
  @Authenticated()
  @AllowMustChangePin()
  async changePin(
    @Param('audience', AudiencePipe) audience: Audience,
    @CurrentAuth() claims: AccessClaims,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parseOrThrow(changePinSchema, body);
    const { session } = await this.auth.changePin(
      audience,
      claims.userId,
      input.currentPin,
      input.newPin,
      contextOf(req),
    );
    return this.deliver(audience, req, res, session);
  }

  /** PIN oublié, avec le code de secours : réinitialisation immédiate. */
  @Post('recover/code')
  @HttpCode(200)
  async recoverWithCode(
    @Param('audience', AudiencePipe) audience: Audience,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parseOrThrow(recoverWithCodeSchema, body);
    const { user, recoveryCode, session } = await this.recovery.recoverWithCode(
      audience,
      input,
      contextOf(req),
    );
    return { user, recoveryCode, ...this.deliver(audience, req, res, session) };
  }

  /**
   * PIN oublié, avec date de naissance + réponses secrètes. 200 : appliqué (client).
   * 202 : en attente, à finaliser à l'échéance (compte ayant un rôle dans un restaurant).
   */
  @Post('recover/questions')
  @HttpCode(200)
  async recoverWithQuestions(
    @Param('audience', AudiencePipe) audience: Audience,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parseOrThrow(recoverWithQuestionsSchema, body);
    const result = await this.recovery.recoverWithQuestions(audience, input, contextOf(req));
    if (result.status === 'pending') {
      res.status(202);
      return { status: 'pending', availableAt: result.availableAt.toISOString() };
    }
    return {
      status: 'completed',
      user: result.user,
      ...this.deliver(audience, req, res, result.session),
    };
  }

  /** Fin d'une récupération différée, après l'échéance. */
  @Post('recover/complete')
  @HttpCode(200)
  async completeRecovery(
    @Param('audience', AudiencePipe) audience: Audience,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parseOrThrow(completeRecoverySchema, body);
    const { user, session } = await this.recovery.completePending(audience, input, contextOf(req));
    return { user, ...this.deliver(audience, req, res, session) };
  }

  /** « Ce n'est pas moi » : annule les récupérations en attente du compte connecté. */
  @Post('recover/cancel')
  @HttpCode(200)
  @Authenticated()
  @AllowMustChangePin()
  async cancelRecovery(@CurrentAuth() claims: AccessClaims) {
    return { cancelled: await this.recovery.cancelOwn(claims.userId) };
  }

  /** Nouveau code de secours (confirmé par le PIN) ; l'ancien cesse de fonctionner. */
  @Post('recovery-code')
  @HttpCode(200)
  @Authenticated()
  regenerateRecoveryCode(
    @CurrentAuth() claims: AccessClaims,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const input = parseOrThrow(regenerateRecoveryCodeSchema, body);
    return this.recovery.regenerateCode(claims.userId, input.pin, contextOf(req));
  }

  private readRefreshToken(
    audience: Audience,
    req: Request,
    body: { refreshToken?: string } | undefined,
  ): string | undefined {
    if (isNative(req))
      return typeof body?.refreshToken === 'string' ? body.refreshToken : undefined;
    const cookie = (req.cookies as Record<string, string> | undefined)?.[cookieName(audience)];
    return typeof cookie === 'string' ? cookie : undefined;
  }

  private cookieOptions(audience: Audience) {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.config.secureCookies,
      path: `/auth/${audience}`,
    };
  }

  /** Pose le cookie (web) ou renvoie le refresh token (natif) ; jamais les deux. */
  private deliver(audience: Audience, req: Request, res: Response, session: IssuedSession) {
    const base = { accessToken: session.accessToken, expiresIn: session.expiresIn };
    if (isNative(req)) return { ...base, refreshToken: session.refreshToken };
    res.cookie(cookieName(audience), session.refreshToken, {
      ...this.cookieOptions(audience),
      maxAge: session.refreshTtlSeconds * 1000,
    });
    return base;
  }
}
