import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HasherService } from '../src/modules/auth/hasher.service.js';
import { PrismaService } from '../src/prisma.service.js';
import { DEMO_ACCOUNTS, DEMO_PIN, DEMO_RESTAURANT_SLUG, runSeed } from '../src/seed-data.js';
import { client } from './auth-helpers.js';
import { createTestApp } from './helpers.js';

describe('Seed de démonstration (vraie base resto_test)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hasher: HasherService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    hasher = app.get(HasherService);
    await runSeed(prisma, hasher);
  });

  afterAll(async () => {
    await app.close();
  });

  it('crée le restaurant et tous les comptes', async () => {
    const restaurant = await prisma.restaurant.findUniqueOrThrow({
      where: { slug: DEMO_RESTAURANT_SLUG },
      include: { memberships: true },
    });
    expect(restaurant.memberships.map((m) => m.role).sort()).toEqual([
      'CASHIER',
      'OWNER',
      'PREPARATOR',
      'SUPERVISOR',
      'WAITER',
    ]);
    expect(
      await prisma.user.count({ where: { phone: { in: DEMO_ACCOUNTS.map((a) => a.phone) } } }),
    ).toBe(6);
  });

  it('est relançable sans doublon', async () => {
    await runSeed(prisma, hasher);
    expect(await prisma.restaurant.count({ where: { slug: DEMO_RESTAURANT_SLUG } })).toBe(1);
    expect(
      await prisma.user.count({ where: { phone: { in: DEMO_ACCOUNTS.map((a) => a.phone) } } }),
    ).toBe(6);
  });

  it.each(DEMO_ACCOUNTS.filter((a) => a.role !== 'CUSTOMER'))(
    '$role se connecte au back-office avec le PIN de démo et son bon rôle',
    async ({ phone, role }) => {
      const login = await client(app)
        .post('/auth/staff/login')
        .send({ phone, pin: DEMO_PIN })
        .expect(200);
      expect(login.body.mustChangePin).toBe(false);
      const me = await client(app)
        .get('/auth/staff/me')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);
      expect(me.body.memberships).toHaveLength(1);
      expect(me.body.memberships[0].role).toBe(role);
    },
  );

  it('le client de démo se connecte à la vitrine, sans rôle', async () => {
    const customer = DEMO_ACCOUNTS.find((a) => a.role === 'CUSTOMER')!;
    const login = await client(app)
      .post('/auth/customer/login')
      .send({ phone: customer.phone, pin: DEMO_PIN })
      .expect(200);
    expect(login.body.user.phoneVerified).toBe(true);
  });
});
