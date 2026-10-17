import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { RestaurantsModule } from './modules/restaurants/restaurants.module.js';
import { TestSupportModule } from './modules/test-support/test-support.module.js';
import { TeamModule } from './modules/team/team.module.js';
import { PrismaModule } from './prisma.module.js';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    AuthModule,
    RestaurantsModule,
    TeamModule,
    // Lecture des emails par les tests Playwright : jamais hors NODE_ENV=test.
    ...(process.env.NODE_ENV === 'test' ? [TestSupportModule] : []),
  ],
  controllers: [HealthController],
})
export class AppModule {}
