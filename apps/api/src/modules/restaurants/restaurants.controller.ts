import { createRestaurantSchema } from '@resto/shared';
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { parseOrThrow } from '../../common/zod-validation.pipe.js';
import { type AccessClaims } from '../auth/token.service.js';
import { Authenticated, CurrentAuth } from '../auth/auth.guard.js';
import { RestaurantRoles } from '../auth/restaurant-roles.guard.js';
import { RestaurantsService } from './restaurants.service.js';

@Controller('restaurants')
export class RestaurantsController {
  constructor(private readonly restaurants: RestaurantsService) {}

  @Post()
  @Authenticated('staff')
  create(@CurrentAuth() claims: AccessClaims, @Body() body: unknown) {
    return this.restaurants.create(claims.userId, parseOrThrow(createRestaurantSchema, body));
  }

  @Get('mine')
  @Authenticated('staff')
  mine(@CurrentAuth() claims: AccessClaims) {
    return this.restaurants.listMine(claims.userId);
  }

  @Get(':restaurantId')
  @RestaurantRoles()
  get(@Param('restaurantId') restaurantId: string) {
    return this.restaurants.get(restaurantId);
  }
}
