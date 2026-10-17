'use client';

import { LocaleSwitcher, storeLocale, useAuth, useI18n } from '@resto/ui';
import { Button } from '@resto/ui/components/ui/button';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/** En-tête de la vitrine : marque, connexion / compte, langue. */
export function SiteHeader() {
  const { t } = useI18n();
  const { status, me } = useAuth();
  const router = useRouter();

  return (
    <header className="bg-background flex items-center justify-between gap-2 border-b px-4 py-2">
      <Link href="/" className="text-lg font-semibold">
        {t('common.appName')}
      </Link>
      <div className="flex items-center gap-2">
        {status === 'authenticated' && me ? (
          <Button asChild variant="ghost" size="sm">
            <Link href="/account">{t('storefront.account')}</Link>
          </Button>
        ) : status === 'anonymous' ? (
          <Button asChild size="sm">
            <Link href="/login">{t('storefront.login')}</Link>
          </Button>
        ) : null}
        <LocaleSwitcher
          onChange={(locale) => {
            storeLocale(locale);
            router.refresh();
          }}
        />
      </div>
    </header>
  );
}
