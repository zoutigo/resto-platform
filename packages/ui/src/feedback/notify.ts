'use client';

import { toast } from 'sonner';

/**
 * Seul point d'entrée des toasts : toute action utilisateur annonce son résultat ici.
 * (Ne jamais appeler `toast()` directement ailleurs — règle ESLint.)
 */
export const notify = {
  success: (message: string) => toast.success(message),
  error: (message: string) => toast.error(message),
  info: (message: string) => toast.info(message),
};
