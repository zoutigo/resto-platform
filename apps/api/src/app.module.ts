import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { RestaurantsModule } from './modules/restaurants/restaurants.module.js';
import { TeamModule } from './modules/team/team.module.js';
import { PrismaModule } from './prisma.module.js';

@Module({
  imports: [PrismaModule, AuthModule, RestaurantsModule, TeamModule],
  controllers: [HealthController],
})
export class AppModule {}
