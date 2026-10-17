'use client';

import {
  AuthShell,
  LocaleSwitcher,
  RegisterEmailForm,
  RegisterPhoneForm,
  useI18n,
  storeLocale,
} from '@resto/ui';
import { Button } from '@resto/ui/components/ui/button';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function RegisterPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [method, setMethod] = useState<'phone' | 'email'>('phone');
  const done = () => router.replace('/onboarding');

  return (
    <AuthShell
      title={method === 'phone' ? t('auth.register.titleStaff') : t('auth.email.registerTitle')}
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
          <Button
            type="button"
            variant="link"
            className="h-auto justify-start p-0"
            onClick={() => setMethod(method === 'phone' ? 'email' : 'phone')}
          >
            {method === 'phone' ? t('auth.register.withEmail') : t('auth.register.withPhone')}
          </Button>
          <p>
            {t('auth.register.haveAccount')}{' '}
            <Link href="/login" className="text-primary underline-offset-4 hover:underline">
              {t('auth.login.submit')}
            </Link>
          </p>
        </>
      }
    >
      {method === 'phone' ? (
        <RegisterPhoneForm audience="staff" onDone={done} />
      ) : (
        <RegisterEmailForm onDone={done} />
      )}
    </AuthShell>
  );
}
