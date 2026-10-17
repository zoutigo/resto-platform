import {
  addEmailSchema,
  addPhoneSchema,
  confirmEmailSchema,
  forgotSchema,
  googleLoginSchema,
  loginEmailSchema,
  recoverEmailSchema,
  registerEmailSchema,
  resendRegistrationSchema,
  verifyRegistrationSchema,
} from '@resto/shared';
import { Body, Controller, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { parseOrThrow } from '../../common/zod-validation.pipe.js';
import { AccountService } from './account.service.js';
import { AudiencePipe } from './audience.pipe.js';
import { AUTH_CONFIG, type AuthConfig } from './auth.config.js';
import { Authenticated, CurrentAuth } from './auth.guard.js';
import { contextOf, deliverSession } from './auth-transport.js';
import { EmailAuthService } from './email-auth.service.js';
import { GoogleAuthService } from './google-auth.service.js';
import type { AccessClaims, Audience } from './token.service.js';

/**
 * Méthodes de connexion complémentaires au téléphone + PIN : email + mot de passe, Google,
 * et rattachement d'un email ou d'un numéro à un compte existant.
 */
@Controller('auth/:audience')
export class EmailAuthController {
  constructor(
    private readonly emailAuth: EmailAuthService,
    private readonly google: GoogleAuthService,
    private readonly account: AccountService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Post('register-email')
  @HttpCode(202)
  registerEmail(
    @Param('audience', AudiencePipe) audience: Audience,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.emailAuth.startRegistration(
      audience,
      parseOrThrow(registerEmailSchema, body),
      contextOf(req),
    );
  }

  @Post('register-email/resend')
  @HttpCode(202)
  resendRegistration(
    @Param('audience', AudiencePipe) audience: Audience,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const input = parseOrThrow(resendRegistrationSchema, body);
    return this.emailAuth.resendRegistration(audience, input.email, input.locale, contextOf(req));
  }

  @Post('register-email/verify')
  async verifyRegistration(
    @Param('audience', AudiencePipe) audience: Audience,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, session } = await this.emailAuth.completeRegistration(
      audience,
      parseOrThrow(verifyRegistrationSchema, body),
      contextOf(req),
    );
    return { user, ...deliverSession(this.config, audience, req, res, session) };
  }

  @Post('login-email')
  @HttpCode(200)
  async loginEmail(
    @Param('audience', AudiencePipe) audience: Audience,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, mustChangePin, recoveryCancelled, session } = await this.emailAuth.login(
      audience,
      parseOrThrow(loginEmailSchema, body),
      contextOf(req),
    );
    return {
      user,
      mustChangePin,
      recoveryCancelled,
      ...deliverSession(this.config, audience, req, res, session),
    };
  }

  @Post('email/forgot')
  @HttpCode(202)
  forgot(@Body() body: unknown, @Req() req: Request) {
    const input = parseOrThrow(forgotSchema, body);
    return this.emailAuth.forgot(input.email, input.locale, contextOf(req));
  }

  @Post('recover/email')
  @HttpCode(200)
  async recoverWithEmail(
    @Param('audience', AudiencePipe) audience: Audience,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, session } = await this.emailAuth.recoverWithEmail(
      audience,
      parseOrThrow(recoverEmailSchema, body),
      contextOf(req),
    );
    return { user, ...deliverSession(this.config, audience, req, res, session) };
  }

  @Post('email/add')
  @HttpCode(202)
  @Authenticated()
  addEmail(@CurrentAuth() claims: AccessClaims, @Body() body: unknown, @Req() req: Request) {
    const input = parseOrThrow(addEmailSchema, body);
    return this.emailAuth.addEmail(claims.userId, input.email, input.locale, contextOf(req));
  }

  @Post('email/confirm')
  @HttpCode(200)
  @Authenticated()
  confirmEmail(@CurrentAuth() claims: AccessClaims, @Body() body: unknown, @Req() req: Request) {
    const input = parseOrThrow(confirmEmailSchema, body);
    return this.emailAuth.confirmEmail(claims.userId, input.code, input.email, contextOf(req));
  }

  @Post('phone')
  @HttpCode(200)
  @Authenticated()
  addPhone(@CurrentAuth() claims: AccessClaims, @Body() body: unknown, @Req() req: Request) {
    return this.account.addPhone(
      claims.userId,
      parseOrThrow(addPhoneSchema, body).phone,
      contextOf(req),
    );
  }

  @Post('google')
  @HttpCode(200)
  async googleLogin(
    @Param('audience', AudiencePipe) audience: Audience,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, isNew, recoveryCancelled, session } = await this.google.login(
      audience,
      parseOrThrow(googleLoginSchema, body).idToken,
      contextOf(req),
    );
    return {
      user,
      isNew,
      recoveryCancelled,
      ...deliverSession(this.config, audience, req, res, session),
    };
  }
}
