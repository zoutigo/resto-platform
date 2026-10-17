'use client';

import { AccountPanel, useI18n } from '@resto/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@resto/ui/components/ui/card';
import { useRouter } from 'next/navigation';
import { RequireAuth } from '@/components/layout/session-gate';
import { SiteHeader } from '@/components/layout/site-header';

export default function AccountPage() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <RequireAuth>
      <SiteHeader />
      <main className="mx-auto max-w-xl p-4">
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={1} className="text-xl">
              {t('auth.account.title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AccountPanel onLoggedOut={() => router.replace('/')} />
          </CardContent>
        </Card>
      </main>
    </RequireAuth>
  );
}
