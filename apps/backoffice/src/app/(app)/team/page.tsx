'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useRestaurant } from '@/components/restaurant/restaurant-context';
import { TeamPanel } from '@/components/team/team-panel';

/** Réservé au propriétaire et au gérant ; les autres rôles retournent à l'accueil. */
export default function TeamPage() {
  const router = useRouter();
  const { active } = useRestaurant();
  const allowed = active?.role === 'OWNER' || active?.role === 'SUPERVISOR';

  useEffect(() => {
    if (active && !allowed) router.replace('/');
  }, [active, allowed, router]);

  if (!active || !allowed) return null;
  return <TeamPanel restaurantId={active.restaurant.id} actorRole={active.role} />;
}
