import type { ReactNode } from 'react';

export const metadata = { title: 'Back-office restaurant' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
