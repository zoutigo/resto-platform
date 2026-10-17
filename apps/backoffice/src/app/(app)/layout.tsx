'use client';

import { Button } from '@resto/ui/components/ui/button';
import { Skeleton } from '@resto/ui/components/ui/skeleton';
import { useI18n } from '@resto/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { RequireAuth } from '@/components/layout/session-gate';
import { RestaurantProvider, useRestaurant } from '@/components/restaurant/restaurant-context';

function Gate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const { status, active, reload } = useRestaurant();

  useEffect(() => {
    if (status === 'ready' && !active) router.replace('/onboarding');
  }, [status, active, router]);

  if (status === 'error') {
    return (
      <main className="space-y-4 p-6">
        <p role="alert">{t('dashboard.loadError')}</p>
        <Button onClick={() => void reload()}>{t('dashboard.retry')}</Button>
      </main>
    );
  }
  if (status !== 'ready' || !active) {
    return (
      <main className="p-6" aria-busy="true" aria-label={t('common.loading')}>
        <Skeleton className="h-8 w-48" />
      </main>
    );
  }
  return <AppShell>{children}</AppShell>;
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <RestaurantProvider>
        <Gate>{children}</Gate>
      </RestaurantProvider>
    </RequireAuth>
  );
}
