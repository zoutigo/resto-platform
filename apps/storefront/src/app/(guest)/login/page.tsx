'use client';

import { AuthShell, LocaleSwitcher, LoginForm, storeLocale, useI18n } from '@resto/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <AuthShell
      title={t('auth.login.title')}
      subtitle={t('auth.login.subtitleCustomer')}
      header={
        <LocaleSwitcher
          onChange={(locale) => {
            storeLocale(locale);
            router.refresh();
          }}
        />
      }
      footer={
        <>
          <Link href="/forgot" className="text-primary underline-offset-4 hover:underline">
            {t('auth.login.forgot')}
          </Link>
          <p>
            {t('auth.login.noAccount')}{' '}
            <Link href="/register" className="text-primary underline-offset-4 hover:underline">
              {t('auth.login.createAccount')}
            </Link>
          </p>
        </>
      }
    >
      <LoginForm
        googleClientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID}
        onSuccess={() => router.replace('/')}
      />
    </AuthShell>
  );
}
