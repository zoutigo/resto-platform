import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { type JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from 'jose';

export interface GoogleProfile {
  /** Identifiant stable du compte Google */
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
}

export interface GoogleVerifier {
  verify(idToken: string): Promise<GoogleProfile>;
}

export const GOOGLE_VERIFIER = Symbol('GOOGLE_VERIFIER');

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';

/**
 * Vérifie l'ID token Google (signature, émetteur, audience, expiration) avec les clés
 * publiques de Google. Fonctionne pour le web (Google Identity Services) comme pour le
 * mobile natif : seul l'ID token compte, pas le parcours de redirection.
 */
export class JoseGoogleVerifier implements GoogleVerifier {
  constructor(
    private readonly clientId: string | undefined,
    private readonly keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(GOOGLE_JWKS)),
  ) {}

  async verify(idToken: string): Promise<GoogleProfile> {
    if (!this.clientId) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'ServiceUnavailable',
        message: 'google.notConfigured',
      });
    }
    try {
      const { payload } = await jwtVerify(idToken, this.keys, {
        issuer: GOOGLE_ISSUERS,
        audience: this.clientId,
        algorithms: ['RS256'],
      });
      if (!payload.sub) throw new Error('sub manquant');
      const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
      return {
        sub: payload.sub,
        email,
        emailVerified: payload.email_verified === true,
        name:
          typeof payload.name === 'string' && payload.name.trim().length >= 2
            ? payload.name.trim().slice(0, 60)
            : (email?.split('@')[0] ?? 'Utilisateur'),
      };
    } catch {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'google.invalidToken',
      });
    }
  }
}
