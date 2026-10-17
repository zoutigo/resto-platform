import type { ReactNode } from 'react';
import { GuestOnly } from '@/components/layout/session-gate';

export default function GuestLayout({ children }: { children: ReactNode }) {
  return <GuestOnly>{children}</GuestOnly>;
}
