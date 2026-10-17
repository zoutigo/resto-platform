import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale, isLocale } from '@resto/ui';

/** Mémorise la langue choisie (cookie lu côté serveur au prochain rendu). */
export function storeLocale(locale: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}

/** Langue demandée par le cookie, ou le français par défaut. */
export function resolveLocale(cookieValue: string | undefined): Locale {
  return isLocale(cookieValue) ? cookieValue : DEFAULT_LOCALE;
}
