import type { Role } from '@resto/shared';
import { normalizeAnswer } from '@resto/shared';
import type { HasherService } from './modules/auth/hasher.service.js';
import type { PrismaService } from './prisma.service.js';

/** Identifiants de démonstration, affichés par `npm run db:seed` et documentés dans le README. */
export const DEMO_PIN = '483920';
export const DEMO_RESTAURANT_SLUG = 'chez-mama-africa';
export const DEMO_ACCOUNTS: { phone: string; name: string; role: Role | 'CUSTOMER' }[] = [
  { phone: '+237690000001', name: 'Mama Africa', role: 'OWNER' },
  { phone: '+237690000002', name: 'Gérant Démo', role: 'SUPERVISOR' },
  { phone: '+237690000003', name: 'Serveur Démo', role: 'WAITER' },
  { phone: '+237690000004', name: 'Caissier Démo', role: 'CASHIER' },
  { phone: '+237690000005', name: 'Cuisinier Démo', role: 'PREPARATOR' },
  { phone: '+237690000006', name: 'Client Démo', role: 'CUSTOMER' },
];

/** Crée le restaurant de démo et ses comptes ; relançable sans doublon. */
export async function runSeed(prisma: PrismaService, hasher: HasherService): Promise<void> {
  const pinHash = await hasher.hashSecret(DEMO_PIN);
  const birthDateHash = await hasher.hashRecoveryValue('1985-06-15');
  const recoveryAnswers = await Promise.all(
    [
      ['BIRTH_CITY', 'Douala'],
      ['CUSTOM_SECRET', 'mamacolo'],
    ].map(async ([question, answer]) => ({
      question: question!,
      answerHash: await hasher.hashRecoveryValue(normalizeAnswer(answer!)),
    })),
  );

  const restaurant = await prisma.restaurant.upsert({
    where: { slug: DEMO_RESTAURANT_SLUG },
    update: {},
    create: {
      slug: DEMO_RESTAURANT_SLUG,
      name: 'Chez Mama Africa',
      city: 'Douala',
      address: 'Akwa, près du marché',
      isPublic: true,
    },
  });

  for (const account of DEMO_ACCOUNTS) {
    const exists = await prisma.user.findUnique({ where: { phone: account.phone } });
    if (exists) continue;
    const isOwner = account.role === 'OWNER';
    const user = await prisma.user.create({
      data: {
        name: account.name,
        phone: account.phone,
        phoneVerifiedAt: new Date(),
        phoneVerifiedMethod: 'CALLBACK',
        managedByRestaurantId: account.role === 'CUSTOMER' || isOwner ? null : restaurant.id,
        credentials: { create: { type: 'PIN', hash: pinHash } },
        ...(isOwner || account.role === 'CUSTOMER'
          ? {
              recoveryProfile: {
                create: {
                  birthDateHash,
                  answers: { create: isOwner ? recoveryAnswers : recoveryAnswers.slice(0, 1) },
                },
              },
            }
          : {}),
      },
    });
    if (account.role !== 'CUSTOMER') {
      await prisma.membership.create({
        data: {
          userId: user.id,
          restaurantId: restaurant.id,
          role: account.role,
          status: 'ACTIVE',
        },
      });
    }
  }
}
