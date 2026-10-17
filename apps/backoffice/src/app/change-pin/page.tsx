'use client';

import { AuthShell, ChangePinForm, useI18n } from '@resto/ui';
import { useRouter } from 'next/navigation';
import { RequireAuth } from '@/components/layout/session-gate';

export default function ChangePinPage() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <RequireAuth>
      <AuthShell title={t('auth.changePin.title')} subtitle={t('auth.changePin.mandatory')}>
        <ChangePinForm onDone={() => router.replace('/')} />
      </AuthShell>
    </RequireAuth>
  );
}
