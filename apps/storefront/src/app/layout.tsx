import { I18nProvider } from '@resto/ui';
import { resolveLocale } from '@resto/ui/locale';
import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Resto — Restaurants au Cameroun',
  description: 'Réservez une table et commandez à emporter dans vos restaurants.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = resolveLocale((await cookies()).get('locale')?.value);
  return (
    <html lang={locale}>
      <body>
        <I18nProvider locale={locale}>
          <Providers>{children}</Providers>
        </I18nProvider>
      </body>
    </html>
  );
}
