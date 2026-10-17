import { z } from 'zod';

/**
 * Numéros mobiles camerounais : 9 chiffres commençant par 6, indicatif +237.
 * Les fixes (commençant par 2) ne sont pas acceptés : on doit pouvoir rappeler le client.
 */
const MOBILE = /^6\d{8}$/;

/** Retire espaces, points, tirets, parenthèses ; gère +237, 00237 et 237. */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/[\s.\-()]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith('237') && digits.length === 12) digits = digits.slice(3);
  return MOBILE.test(digits) ? `+237${digits}` : null;
}

/** Valide et normalise : la sortie est toujours `+2376XXXXXXXX`. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const phone = normalizePhone(value);
    if (!phone) {
      ctx.addIssue({ code: 'custom', message: 'phone.invalid' });
      return z.NEVER;
    }
    return phone;
  });

export type Phone = z.output<typeof phoneSchema>;
