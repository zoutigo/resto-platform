import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { HasherService } from './modules/auth/hasher.service.js';
import { PrismaService } from './prisma.service.js';
import { DEMO_ACCOUNTS, DEMO_PIN, DEMO_RESTAURANT_SLUG, runSeed } from './seed-data.js';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Le seed de démonstration est interdit en production.');
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    await runSeed(app.get(PrismaService), app.get(HasherService));
    console.log(
      `Restaurant de démo « ${DEMO_RESTAURANT_SLUG} » prêt. PIN de tous les comptes : ${DEMO_PIN}`,
    );
    for (const a of DEMO_ACCOUNTS) console.log(`  ${a.role.padEnd(10)} ${a.phone}  ${a.name}`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
