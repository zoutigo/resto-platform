import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALES, isLocale, resolveLocale } from './locale';

describe('locale', () => {
  it('reconnaît fr et en seulement', () => {
    expect(LOCALES).toEqual(['fr', 'en']);
    expect(isLocale('fr')).toBe(true);
    expect(isLocale('en')).toBe(true);
    for (const bad of ['de', 'FR', '', undefined, null, 1]) expect(isLocale(bad)).toBe(false);
  });

  it('resolveLocale retient la langue du cookie, sinon le français', () => {
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('fr')).toBe('fr');
    expect(resolveLocale('de')).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined)).toBe('fr');
  });
});
