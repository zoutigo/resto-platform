import { describe, expect, it } from 'vitest';
import { ROLES, addStaffSchema, canManageRole, createRestaurantSchema, slugify } from './team.js';

describe('canManageRole', () => {
  it('le propriétaire gère tous les employés mais jamais un propriétaire', () => {
    expect(canManageRole('OWNER', 'SUPERVISOR')).toBe(true);
    expect(canManageRole('OWNER', 'WAITER')).toBe(true);
    expect(canManageRole('OWNER', 'OWNER')).toBe(false);
  });

  it('le gérant gère le service seulement', () => {
    for (const target of ['WAITER', 'CASHIER', 'PREPARATOR'] as const) {
      expect(canManageRole('SUPERVISOR', target)).toBe(true);
    }
    expect(canManageRole('SUPERVISOR', 'SUPERVISOR')).toBe(false);
    expect(canManageRole('SUPERVISOR', 'OWNER')).toBe(false);
  });

  it.each(['WAITER', 'CASHIER', 'PREPARATOR'] as const)('%s ne gère personne', (actor) => {
    for (const target of ROLES) expect(canManageRole(actor, target)).toBe(false);
  });
});

describe('slugify', () => {
  it.each([
    ['Chez Mama Africa', 'chez-mama-africa'],
    ["Café de l'Étoile", 'cafe-de-l-etoile'],
    ['  --Le Fouquet’s 237--  ', 'le-fouquet-s-237'],
    ['!!!', ''],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('tronque sans finir par un tiret', () => {
    const slug = slugify(`${'a'.repeat(49)} bbb`);
    expect(slug.length).toBeLessThanOrEqual(50);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('createRestaurantSchema', () => {
  it('accepte un restaurant valide', () => {
    expect(createRestaurantSchema.safeParse({ name: 'Chez Mama', city: 'Douala' }).success).toBe(
      true,
    );
  });

  it.each([
    { name: 'A', city: 'Douala' },
    { name: '!!!', city: 'Douala' },
    { name: 'Chez Mama', city: '' },
    { name: 'Chez Mama', city: 'Douala', address: 'x'.repeat(201) },
  ])('refuse %j', (value) => {
    expect(createRestaurantSchema.safeParse(value).success).toBe(false);
  });
});

describe('addStaffSchema', () => {
  it('normalise le téléphone', () => {
    const r = addStaffSchema.parse({ name: 'Jean Nkoulou', phone: '655 11 22 33', role: 'WAITER' });
    expect(r.phone).toBe('+237655112233');
  });

  it('refuse le rôle OWNER et les rôles inconnus', () => {
    expect(
      addStaffSchema.safeParse({ name: 'Jean', phone: '655112233', role: 'OWNER' }).success,
    ).toBe(false);
    expect(
      addStaffSchema.safeParse({ name: 'Jean', phone: '655112233', role: 'BOSS' }).success,
    ).toBe(false);
  });
});
