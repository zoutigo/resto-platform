import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { PrismaModule } from './prisma.module.js';

@Module({ imports: [PrismaModule], controllers: [HealthController] })
export class AppModule {}
