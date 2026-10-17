'use client';

import { AuthShell, useAuth, useI18n } from '@resto/ui';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { RequireAuth } from '@/components/layout/session-gate';
import { CreateRestaurantForm } from '@/components/restaurant/create-restaurant-form';

function Onboarding() {
  const { t } = useI18n();
  const { api } = useAuth();
  const router = useRouter();

  // Quelqu'un qui a déjà un restaurant n'a rien à faire ici.
  useEffect(() => {
    api
      .myRestaurants()
      .then((list) => list.length > 0 && router.replace('/'))
      .catch(() => undefined);
  }, [api, router]);

  return (
    <AuthShell title={t('restaurant.createTitle')} subtitle={t('restaurant.createText')}>
      <CreateRestaurantForm onDone={() => router.replace('/')} />
    </AuthShell>
  );
}

export default function OnboardingPage() {
  return (
    <RequireAuth>
      <Onboarding />
    </RequireAuth>
  );
}
