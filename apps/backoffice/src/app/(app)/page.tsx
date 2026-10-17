'use client';

import { useAuth, useI18n } from '@resto/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@resto/ui/components/ui/card';
import { useRestaurant } from '@/components/restaurant/restaurant-context';

export default function DashboardPage() {
  const { t } = useI18n();
  const { me } = useAuth();
  const { active } = useRestaurant();
  if (!active || !me) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t('dashboard.welcome', { name: me.user.name })}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{active.restaurant.name}</CardTitle>
          <CardDescription>
            {[active.restaurant.city, active.restaurant.address].filter(Boolean).join(' — ')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p data-testid="role">{t('dashboard.yourRole', { role: t(`roles.${active.role}`) })}</p>
          <p className="text-muted-foreground">{t('dashboard.soon')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
