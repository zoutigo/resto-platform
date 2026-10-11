import type { ReactNode } from 'react';

export const metadata = { title: 'Vitrine' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
