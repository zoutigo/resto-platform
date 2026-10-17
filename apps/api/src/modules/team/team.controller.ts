import { addStaffSchema, changeStaffRoleSchema } from '@resto/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { parseOrThrow } from '../../common/zod-validation.pipe.js';
import {
  type ActiveMembership,
  CurrentMembership,
  RestaurantRoles,
} from '../auth/restaurant-roles.guard.js';
import { TeamService } from './team.service.js';

/** Gestion de l'équipe : propriétaire et gérant (le service limite ce que chacun peut faire). */
@Controller('restaurants/:restaurantId/team')
@RestaurantRoles('OWNER', 'SUPERVISOR')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  list(@Param('restaurantId') restaurantId: string) {
    return this.team.list(restaurantId);
  }

  @Post()
  add(@CurrentMembership() actor: ActiveMembership, @Body() body: unknown) {
    return this.team.add(actor, parseOrThrow(addStaffSchema, body));
  }

  @Patch(':memberId')
  changeRole(
    @CurrentMembership() actor: ActiveMembership,
    @Param('memberId') memberId: string,
    @Body() body: unknown,
  ) {
    return this.team.changeRole(actor, memberId, parseOrThrow(changeStaffRoleSchema, body).role);
  }

  @Post(':memberId/reset-pin')
  @HttpCode(200)
  resetPin(@CurrentMembership() actor: ActiveMembership, @Param('memberId') memberId: string) {
    return this.team.resetPin(actor, memberId);
  }

  @Post(':memberId/cancel-recovery')
  @HttpCode(200)
  cancelRecovery(
    @CurrentMembership() actor: ActiveMembership,
    @Param('memberId') memberId: string,
  ) {
    return this.team.cancelRecovery(actor, memberId);
  }

  @Delete(':memberId')
  @HttpCode(204)
  remove(@CurrentMembership() actor: ActiveMembership, @Param('memberId') memberId: string) {
    return this.team.remove(actor, memberId);
  }
}
