import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from './en';
import { fr } from './fr';
import { createTranslator, interpolate, translate, translateError } from './index';

/** Liste à plat toutes les clés d'un dictionnaire (`a.b.c`, `errors.pin.weak`…). */
function keysOf(node: unknown, prefix = ''): string[] {
  if (Array.isArray(node)) return [`${prefix}[${node.length}]`];
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (['node_modules', 'generated', 'dist', 'test'].includes(name)) return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(name) && !/\.(spec|e2e-spec|d)\.ts$/.test(name) ? [path] : [];
  });
}

const root = join(__dirname, '../../../..');

describe('dictionnaires', () => {
  it('le français et l’anglais ont exactement les mêmes clés', () => {
    expect(keysOf(en).sort()).toEqual(keysOf(fr).sort());
  });

  it('aucun texte vide', () => {
    for (const dict of [fr, en]) {
      const empty = keysOf(dict).filter((k) => {
        const value = k
          .split('.')
          .reduce<unknown>((n, p) => (n as Record<string, unknown>)?.[p], dict);
        return value === '';
      });
      expect(empty).toEqual([]);
    }
  });

  it('les paramètres {…} sont identiques dans les deux langues', () => {
    const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of keysOf(fr)) {
      if (key.includes('[')) continue;
      const get = (d: unknown) =>
        key.split('.').reduce<unknown>((n, p) => (n as Record<string, unknown>)?.[p], d);
      const a = get(fr);
      const b = get(en);
      // Les clés d'erreur contiennent des points : on les relit à plat.
      if (typeof a === 'string' && typeof b === 'string') expect(params(b)).toEqual(params(a));
    }
    for (const [k, v] of Object.entries(fr.errors)) {
      expect(params((en.errors as Record<string, string>)[k]!)).toEqual(params(v));
    }
  });

  it('douze mois dans chaque langue', () => {
    expect(fr.months).toHaveLength(12);
    expect(en.months).toHaveLength(12);
  });

  it('une question et un rôle traduits pour chaque valeur de @resto/shared', async () => {
    const { RECOVERY_QUESTIONS, ROLES } = await import('@resto/shared');
    for (const dict of [fr, en]) {
      for (const q of RECOVERY_QUESTIONS) expect(dict.questions[q]).toBeTruthy();
      for (const r of ROLES) expect(dict.roles[r]).toBeTruthy();
    }
  });
});

describe('couverture des clés d’erreur', () => {
  /** Chaînes `'xxx.yyy'` utilisées comme messages d'erreur dans les schémas partagés et l'API. */
  function usedErrorKeys(): string[] {
    const keys = new Set<string>();
    for (const file of sourceFiles(join(root, 'packages/shared/src'))) {
      const text = readFileSync(file, 'utf8');
      // Messages de règles Zod : (…, 'phone.invalid'), message: 'pin.mismatch', { error: 'x.y' }
      for (const m of text.matchAll(/(?:message|error):\s*'([a-zA-Z]+\.[a-zA-Z]+)'/g))
        keys.add(m[1]!);
      for (const m of text.matchAll(/['"]([a-zA-Z]+\.[a-zA-Z]+)['"]\s*\)/g)) keys.add(m[1]!);
      for (const m of text.matchAll(/,\s*'([a-zA-Z]+\.[a-zA-Z]+)'\s*[,)]/g)) keys.add(m[1]!);
    }
    for (const file of sourceFiles(join(root, 'apps/api/src'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/message:\s*'([a-zA-Z]+\.[a-zA-Z]+)'/g)) keys.add(m[1]!);
    }
    return [...keys];
  }

  it('trouve des clés (le scanner fonctionne)', () => {
    expect(usedErrorKeys().length).toBeGreaterThan(40);
  });

  it('chaque clé émise par l’API ou par un schéma partagé est traduite en français et en anglais', () => {
    // Clés qui ne sont pas des messages affichés à l'utilisateur.
    const ignored = new Set(['auth.tooManyAttempts']);
    const missing = usedErrorKeys().filter((k) => !(k in fr.errors) || !(k in en.errors));
    expect(missing.filter((k) => !ignored.has(k))).toEqual([]);
  });
});

describe('traduction', () => {
  it('interpolate remplace les paramètres et laisse visibles les manquants', () => {
    expect(interpolate('Bonjour {name}', { name: 'Awa' })).toBe('Bonjour Awa');
    expect(interpolate('Étape {a}/{b}', { a: 1 })).toBe('Étape 1/{b}');
    expect(interpolate('sans paramètre')).toBe('sans paramètre');
  });

  it('translate lit une clé pointée et renvoie la clé si elle est inconnue', () => {
    expect(translate(fr, 'auth.login.title')).toBe('Connexion');
    expect(translate(fr, 'auth.login.inexistant')).toBe('auth.login.inexistant');
    expect(translate(fr, 'auth.login')).toBe('auth.login'); // un nœud n'est pas un texte
    expect(translate(fr, 'common.step', { current: 2, total: 3 })).toBe('Étape 2 sur 3');
  });

  it('translateError utilise les clés plates et se replie sur le message générique', () => {
    expect(translateError(fr, 'pin.weak')).toContain('trop facile');
    expect(translateError(fr, 'auth.tooManyAttempts', { seconds: 12 })).toContain('12 s');
    expect(translateError(fr, 'cle.inconnue')).toBe(fr.errors.unknown);
  });

  it('createTranslator suit la langue', () => {
    expect(createTranslator('en').t('auth.login.title')).toBe('Log in');
    expect(createTranslator('fr').tError('network.offline')).toContain('connexion');
  });
});
