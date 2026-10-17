'use client';

import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { en } from './en';
import { fr, type Messages } from './fr';

import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale } from './locale';

// `resolveLocale` n'est volontairement PAS réexporté ici : depuis un module client, un composant
// serveur ne pourrait pas l'appeler. Côté serveur : `import { resolveLocale } from '@resto/ui/locale'`.
export { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES, isLocale, type Locale } from './locale';

export const dictionaries: Record<Locale, Messages> = { fr, en };

type Params = Record<string, string | number>;

/** Remplace `{nom}` par la valeur fournie ; un paramètre absent reste visible (aide au débogage). */
export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/** Lit une clé pointée (`auth.login.title`) ; renvoie la clé elle-même si elle n'existe pas. */
export function translate(messages: Messages, key: string, params?: Params): string {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return key;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? interpolate(node, params) : key;
}

/** Message d'erreur de l'API ou d'une règle Zod ; repli sur le message générique. */
export function translateError(messages: Messages, key: string, params?: Params): string {
  const errors = messages.errors as Record<string, string>;
  return interpolate(errors[key] ?? errors.unknown ?? key, params);
}

export interface Translator {
  locale: Locale;
  messages: Messages;
  t: (key: string, params?: Params) => string;
  tError: (key: string, params?: Params) => string;
}

export function createTranslator(locale: Locale): Translator {
  const messages = dictionaries[locale];
  return {
    locale,
    messages,
    t: (key, params) => translate(messages, key, params),
    tError: (key, params) => translateError(messages, key, params),
  };
}

const I18nContext = createContext<Translator>(createTranslator(DEFAULT_LOCALE));

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => createTranslator(locale), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

/** Mémorise la langue choisie (cookie lu côté serveur au prochain rendu). */
export function storeLocale(locale: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}
