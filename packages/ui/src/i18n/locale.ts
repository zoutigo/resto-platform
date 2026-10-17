/**
 * Langue : fonctions pures, utilisables côté serveur ET client (aucune directive 'use client').
 * Le layout serveur de chaque site importe `resolveLocale` d'ici (`@resto/ui/locale`).
 */
export type Locale = 'fr' | 'en';
export const LOCALES: Locale[] = ['fr', 'en'];
export const DEFAULT_LOCALE: Locale = 'fr';
export const LOCALE_COOKIE = 'locale';

export const isLocale = (value: unknown): value is Locale => value === 'fr' || value === 'en';

/** Langue demandée par le cookie, ou le français par défaut. */
export function resolveLocale(cookieValue: string | undefined): Locale {
  return isLocale(cookieValue) ? cookieValue : DEFAULT_LOCALE;
}
