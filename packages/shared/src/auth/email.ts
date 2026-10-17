import { z } from 'zod';
import { phoneSchema } from './phone.js';
import { newPinSchema, pinFormatSchema } from './pin.js';

/** Adresse normalisée : espaces retirés, minuscules. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'email.tooLong')
  .pipe(z.email('email.invalid'));

const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'azerty123',
  'azertyuiop',
  'qwerty123',
  'motdepasse',
  'iloveyou',
  '00000000',
  '11111111',
]);

export function isWeakPassword(password: string): boolean {
  const lower = password.toLowerCase();
  return COMMON_PASSWORDS.has(lower) || /^(.)\1+$/.test(password);
}

/** Mot de passe : 8 caractères minimum, ni trivial ni répétition d'un seul caractère. */
export const passwordSchema = z
  .string()
  .min(8, 'password.tooShort')
  .max(128, 'password.tooLong')
  .refine((p) => !isWeakPassword(p), 'password.weak');

const nameSchema = z.string().trim().min(2, 'name.tooShort').max(60, 'name.tooLong');

/** Code reçu par email : 6 chiffres. */
export const emailCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'emailCode.invalid');

/** Étape 1 de l'inscription par email (le compte n'existe pas encore). */
export const registerEmailSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    passwordConfirm: z.string(),
    locale: z.enum(['fr', 'en']).default('fr'),
  })
  .refine((v) => v.password === v.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'password.mismatch',
  });
export type RegisterEmailInput = z.input<typeof registerEmailSchema>;
export type RegisterEmail = z.output<typeof registerEmailSchema>;

/** Étape 2 : le code reçu par email crée le compte. */
export const verifyRegistrationSchema = z.object({ email: emailSchema, code: emailCodeSchema });

export const resendRegistrationSchema = z.object({
  email: emailSchema,
  locale: z.enum(['fr', 'en']).default('fr'),
});

export const loginEmailSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'password.required').max(128),
});
export type LoginEmailInput = z.input<typeof loginEmailSchema>;

export const forgotSchema = z.object({
  email: emailSchema,
  locale: z.enum(['fr', 'en']).default('fr'),
});

/**
 * Réinitialisation par email : le code reçu autorise soit un nouveau mot de passe, soit
 * un nouveau PIN (compte « téléphone + PIN » ayant un email vérifié) — l'un ou l'autre.
 */
export const recoverEmailSchema = z
  .object({
    email: emailSchema,
    code: emailCodeSchema,
    newPassword: passwordSchema.optional(),
    newPin: newPinSchema.optional(),
    newPinConfirm: pinFormatSchema.optional(),
  })
  .superRefine((v, ctx) => {
    const hasPassword = v.newPassword !== undefined;
    const hasPin = v.newPin !== undefined;
    if (hasPassword === hasPin) {
      ctx.addIssue({ code: 'custom', path: ['newPassword'], message: 'recover.chooseOne' });
      return;
    }
    if (hasPin && v.newPin !== v.newPinConfirm) {
      ctx.addIssue({ code: 'custom', path: ['newPinConfirm'], message: 'pin.mismatch' });
    }
  });
export type RecoverEmailInput = z.input<typeof recoverEmailSchema>;
export type RecoverEmail = z.output<typeof recoverEmailSchema>;

/** Rattacher un email à un compte existant (connecté). */
export const addEmailSchema = z.object({
  email: emailSchema,
  locale: z.enum(['fr', 'en']).default('fr'),
});
export const confirmEmailSchema = z.object({ email: emailSchema, code: emailCodeSchema });

/** Rattacher un numéro à un compte email/Google (connecté). */
export const addPhoneSchema = z.object({ phone: phoneSchema });

export const googleLoginSchema = z.object({
  idToken: z.string().min(20, 'google.invalidToken').max(4096),
});
