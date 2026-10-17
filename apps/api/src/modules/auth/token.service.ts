import { randomBytes } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { AUTH_CONFIG, type AuthConfig } from './auth.config.js';

export type Audience = 'staff' | 'customer';

const ISSUER = 'resto-api';

export interface AccessClaims {
  userId: string;
  audience: Audience;
}

@Injectable()
export class TokenService {
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  /** JWT d'accès court, lié à un espace : un jeton `customer` n'ouvre jamais le back-office. */
  signAccess(claims: AccessClaims): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.userId)
      .setAudience(claims.audience)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${this.config.accessTtlSeconds}s`)
      .sign(this.config.jwtSecret);
  }

  async verifyAccess(token: string, audience: Audience): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.config.jwtSecret, {
        issuer: ISSUER,
        audience,
        algorithms: ['HS256'],
      });
      if (!payload.sub) throw new Error('sub manquant');
      return { userId: payload.sub, audience };
    } catch {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'auth.invalidToken',
      });
    }
  }

  /** 256 bits aléatoires ; seule l'empreinte est stockée. */
  generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }
}
