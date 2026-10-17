import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
  UseGuards,
  applyDecorators,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@resto/shared';
import { PrismaService } from '../../prisma.service.js';
import { Authenticated, type AuthenticatedRequest } from './auth.guard.js';

const ROLES_KEY = 'auth:restaurantRoles';

export interface ActiveMembership {
  restaurantId: string;
  userId: string;
  role: Role;
}

export type RestaurantRequest = AuthenticatedRequest & { membership: ActiveMembership };

/**
 * Route d'un restaurant (`:restaurantId`) réservée à certains rôles du personnel.
 * Sans rôle listé, tout membre actif est accepté. Le rôle est relu en base à chaque
 * requête : une révocation prend effet immédiatement, sans attendre l'expiration du jeton.
 */
export const RestaurantRoles = (...roles: Role[]) =>
  applyDecorators(
    Authenticated('staff'),
    SetMetadata(ROLES_KEY, roles),
    UseGuards(RestaurantRolesGuard),
  );

/** Appartenance de l'utilisateur au restaurant de la route (posée par le garde). */
export const CurrentMembership = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ActiveMembership =>
    ctx.switchToHttp().getRequest<RestaurantRequest>().membership,
);

@Injectable()
export class RestaurantRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RestaurantRequest>();
    const roles =
      this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const param = request.params.restaurantId;
    const restaurantId = typeof param === 'string' ? param : undefined;
    const userId = request.auth?.userId;
    if (!restaurantId || !userId) throw new NotFoundException();

    const membership = await this.prisma.membership.findUnique({
      where: { userId_restaurantId: { userId, restaurantId } },
      select: { role: true, status: true },
    });
    // Un non-membre reçoit la même 404 qu'un restaurant inexistant : on ne révèle rien.
    if (!membership || membership.status !== 'ACTIVE') {
      throw new NotFoundException({
        statusCode: 404,
        error: 'NotFound',
        message: 'restaurant.notFound',
      });
    }
    if (roles.length > 0 && !roles.includes(membership.role)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'restaurant.forbiddenRole',
      });
    }
    request.membership = { restaurantId, userId, role: membership.role };
    return true;
  }
}
