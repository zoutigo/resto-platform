'use client';

import { Toaster as Sonner } from '@resto/ui/components/ui/sonner';

/** Zone d'affichage des toasts, à monter une fois dans le layout de chaque site. */
export function Toaster() {
  return <Sonner position="top-center" richColors closeButton />;
}
