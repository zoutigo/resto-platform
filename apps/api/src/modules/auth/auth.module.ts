import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { RetryAfterFilter } from '../../common/retry-after.filter.js';
import { AUTH_CONFIG, loadAuthConfig } from './auth.config.js';
import { AccessTokenGuard } from './auth.guard.js';
import { AccountService } from './account.service.js';
import { AuthController } from './auth.controller.js';
import { EmailAuthController } from './email-auth.controller.js';
import { EmailAuthService } from './email-auth.service.js';
import { EmailCodeService } from './email-code.service.js';
import { GoogleAuthService } from './google-auth.service.js';
import { GOOGLE_VERIFIER, JoseGoogleVerifier } from './google.verifier.js';
import { AuditService } from './audit.service.js';
import { AuthService } from './auth.service.js';
import { HasherService } from './hasher.service.js';
import { RecoveryService } from './recovery.service.js';
import { SessionService } from './session.service.js';
import { ThrottleService } from './throttle.service.js';
import { TokenService } from './token.service.js';

@Global()
@Module({
  controllers: [AuthController, EmailAuthController],
  providers: [
    { provide: AUTH_CONFIG, useFactory: () => loadAuthConfig() },
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_FILTER, useClass: RetryAfterFilter },
    HasherService,
    TokenService,
    SessionService,
    ThrottleService,
    {
      provide: GOOGLE_VERIFIER,
      useFactory: () => new JoseGoogleVerifier(process.env.GOOGLE_CLIENT_ID),
    },
    AuditService,
    RecoveryService,
    EmailCodeService,
    EmailAuthService,
    GoogleAuthService,
    AccountService,
    AuthService,
  ],
  exports: [
    AUTH_CONFIG,
    HasherService,
    TokenService,
    SessionService,
    ThrottleService,
    AuditService,
    RecoveryService,
  ],
})
export class AuthModule {}
