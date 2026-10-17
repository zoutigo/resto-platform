'use client';

import { AccountPanel, useI18n } from '@resto/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@resto/ui/components/ui/card';
import { useRouter } from 'next/navigation';

export default function AccountPage() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={1} className="text-xl">
            {t('auth.account.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AccountPanel onLoggedOut={() => router.replace('/login')} />
        </CardContent>
      </Card>
    </div>
  );
}
