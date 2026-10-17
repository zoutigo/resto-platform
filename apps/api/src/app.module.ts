import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { PrismaModule } from './prisma.module.js';

@Module({ imports: [PrismaModule, AuthModule], controllers: [HealthController] })
export class AppModule {}
