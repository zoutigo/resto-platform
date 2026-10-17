'use client';

import { GuestOnly as BaseGuestOnly, RequireAuth as BaseRequireAuth } from '@resto/ui';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

/** Page réservée aux clients connectés. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <BaseRequireAuth navigate={(path) => router.replace(path)} pathname={pathname}>
      {children}
    </BaseRequireAuth>
  );
}

/** Pages de connexion/inscription : un connecté est renvoyé à l'accueil. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const router = useRouter();
  return <BaseGuestOnly navigate={(path) => router.replace(path)}>{children}</BaseGuestOnly>;
}
