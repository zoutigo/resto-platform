'use client';

import { AuthShell, ForgotFlow, useI18n } from '@resto/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function ForgotPage() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <AuthShell
      title={t('auth.forgot.title')}
      footer={
        <Link href="/login" className="text-primary underline-offset-4 hover:underline">
          {t('auth.forgot.backToLogin')}
        </Link>
      }
    >
      <ForgotFlow audience="staff" onDone={() => router.replace('/')} />
    </AuthShell>
  );
}
