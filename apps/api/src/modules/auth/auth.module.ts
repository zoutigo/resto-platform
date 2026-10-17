import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { RetryAfterFilter } from '../../common/retry-after.filter.js';
import { AUTH_CONFIG, loadAuthConfig } from './auth.config.js';
import { AccessTokenGuard } from './auth.guard.js';
import { AuthController } from './auth.controller.js';
import { AuditService } from './audit.service.js';
import { AuthService } from './auth.service.js';
import { HasherService } from './hasher.service.js';
import { SessionService } from './session.service.js';
import { ThrottleService } from './throttle.service.js';
import { TokenService } from './token.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    { provide: AUTH_CONFIG, useFactory: () => loadAuthConfig() },
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_FILTER, useClass: RetryAfterFilter },
    HasherService,
    TokenService,
    SessionService,
    ThrottleService,
    AuditService,
    AuthService,
  ],
  exports: [
    AUTH_CONFIG,
    HasherService,
    TokenService,
    SessionService,
    ThrottleService,
    AuditService,
  ],
})
export class AuthModule {}
