import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  NotFoundException,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { type AccessClaims, type Audience, TokenService } from './token.service.js';

const AUDIENCE_KEY = 'auth:audience';

/**
 * Exige un jeton d'accès valide pour l'espace indiqué (`staff` ou `customer`).
 * Sans argument, l'espace est lu dans le paramètre de route `:audience`.
 */
export const Authenticated = (audience: Audience | 'param' = 'param') =>
  SetMetadata(AUDIENCE_KEY, audience);

export type AuthenticatedRequest = Request & { auth: AccessClaims };

/** Utilisateur authentifié de la requête (posé par `AccessTokenGuard`). */
export const CurrentAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AccessClaims =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth,
);

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Audience | 'param' | undefined>(
      AUDIENCE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const audience = required === 'param' ? request.params.audience : required;
    if (audience !== 'staff' && audience !== 'customer') throw new NotFoundException();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'auth.missingToken',
      });
    }
    request.auth = await this.tokens.verifyAccess(token, audience);
    return true;
  }
}
