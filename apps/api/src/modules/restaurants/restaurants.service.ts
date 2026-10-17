import { randomBytes } from 'node:crypto';
import type { CreateRestaurantInput } from '@resto/shared';
import { slugify } from '@resto/shared';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { AuditService } from '../auth/audit.service.js';
import { ThrottleService } from '../auth/throttle.service.js';

const CREATE_FREE_PER_HOUR = 5;
const MAX_SLUG_ATTEMPTS = 4;

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

const restaurantView = (r: {
  id: string;
  slug: string;
  name: string;
  city: string;
  address: string | null;
  isPublic: boolean;
}) => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  city: r.city,
  address: r.address,
  isPublic: r.isPublic,
});

@Injectable()
export class RestaurantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly throttle: ThrottleService,
    private readonly audit: AuditService,
  ) {}

  /** Crée le restaurant et fait de l'utilisateur son propriétaire, en une transaction. */
  async create(userId: string, input: CreateRestaurantInput & { name: string; city: string }) {
    const key = `restaurant:create:${userId}`;
    await this.throttle.assertAllowed([{ key, free: CREATE_FREE_PER_HOUR }]);
    await this.throttle.recordFailure([key]);

    const base = slugify(input.name);
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
      try {
        const restaurant = await this.prisma.restaurant.create({
          data: {
            slug,
            name: input.name,
            city: input.city,
            address: input.address ?? null,
            memberships: { create: { userId, role: 'OWNER', status: 'ACTIVE' } },
          },
        });
        await this.audit.log({
          action: 'restaurant.created',
          userId,
          restaurantId: restaurant.id,
        });
        return restaurantView(restaurant);
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: 'restaurant.slugTaken',
    });
  }

  /** Les restaurants où l'utilisateur est membre actif (sélecteur du back-office). */
  async listMine(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { restaurant: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({ role: m.role, restaurant: restaurantView(m.restaurant) }));
  }

  async get(restaurantId: string) {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { id: restaurantId } });
    if (!restaurant) throw new NotFoundException();
    return restaurantView(restaurant);
  }
}
