import { z } from 'zod';
import { phoneSchema } from './phone.js';

/** Rôles d'un restaurant, du plus haut au plus bas. */
export const ROLES = ['OWNER', 'SUPERVISOR', 'WAITER', 'CASHIER', 'PREPARATOR'] as const;
export type Role = (typeof ROLES)[number];

/** Rôles attribuables à un employé (le propriétaire est celui qui crée le restaurant). */
export const STAFF_ROLES = ['SUPERVISOR', 'WAITER', 'CASHIER', 'PREPARATOR'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * Qui peut gérer qui : le propriétaire gère tous les employés, le gérant (SUPERVISOR)
 * seulement le service (serveur, caissier, préparateur). Personne ne gère un propriétaire.
 */
export function canManageRole(actor: Role, target: Role): boolean {
  if (target === 'OWNER') return false;
  if (actor === 'OWNER') return true;
  if (actor === 'SUPERVISOR') return target !== 'SUPERVISOR';
  return false;
}

export const roleSchema = z.enum(ROLES);
export const staffRoleSchema = z.enum(STAFF_ROLES);

const nameSchema = z.string().trim().min(2, 'name.tooShort').max(60, 'name.tooLong');

/** « Café de l'Étoile » → `cafe-de-l-etoile`. Vide si le texte ne contient aucun caractère utile. */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
}

export const createRestaurantSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'name.tooShort')
    .max(80, 'name.tooLong')
    .refine((n) => slugify(n).length >= 2, 'name.invalid'),
  city: z.string().trim().min(2, 'city.required').max(60, 'city.tooLong'),
  address: z.string().trim().max(200, 'address.tooLong').optional(),
});
export type CreateRestaurantInput = z.input<typeof createRestaurantSchema>;

export const addStaffSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  role: staffRoleSchema,
});
export type AddStaffInput = z.input<typeof addStaffSchema>;

export const changeStaffRoleSchema = z.object({ role: staffRoleSchema });
