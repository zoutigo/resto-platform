'use client';

import { useAuth, useI18n } from '@resto/ui';

export function HomeContent() {
  const { t } = useI18n();
  const { me } = useAuth();
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">
        {me ? t('storefront.hello', { name: me.user.name }) : t('storefront.welcome')}
      </h1>
      <p className="text-muted-foreground">{t('storefront.tagline')}</p>
      <p className="text-muted-foreground text-sm">{t('storefront.soon')}</p>
    </main>
  );
}
