import { createApiClient } from '@resto/shared';

/** Client de l'API pour l'espace client (jeton d'accès en mémoire, session en cookie httpOnly). */
export const api = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  audience: 'customer',
});
