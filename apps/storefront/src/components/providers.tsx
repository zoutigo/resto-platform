'use client';

import { AuthProvider, Toaster } from '@resto/ui';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider api={api}>
      {children}
      <Toaster />
    </AuthProvider>
  );
}
