import { z } from 'zod';

/** Questions de récupération. `CUSTOM_SECRET` : mot choisi librement par l'utilisateur. */
export const RECOVERY_QUESTIONS = [
  'BIRTH_CITY',
  'FAVORITE_SPORT',
  'FAVORITE_ANIMAL',
  'CUSTOM_SECRET',
] as const;
export type RecoveryQuestion = (typeof RECOVERY_QUESTIONS)[number];

/** Nombre de réponses exigées selon le type de compte. */
export const MIN_RECOVERY_ANSWERS = { customer: 1, owner: 2 } as const;

/**
 * Normalise une réponse libre avant hachage : « Yaoundé », « yaounde » et « YAOUNDE »
 * donnent la même valeur. Minuscules, sans accents, sans espaces ni ponctuation,
 * lettres consécutives identiques réduites (« Foot-ball », « football » et « fotbal »
 * sont équivalents). Les variantes d'orthographe plus larges ne sont pas gérées.
 */
export function normalizeAnswer(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/(.)\1+/g, '$1');
}

export const recoveryQuestionSchema = z.enum(RECOVERY_QUESTIONS, { error: 'question.required' });

const MIN_AGE_YEARS = 10;
const MIN_YEAR = 1900;

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const datePart = z.coerce.number('birthDate.invalid').int('birthDate.invalid');

/**
 * Date de naissance saisie avec trois menus (jour, mois, année) ; sortie `YYYY-MM-DD`.
 * Elle accepte AUSSI sa propre sortie (chaîne ISO) : valider deux fois donne le même résultat,
 * ce qui permet à un formulaire d'envoyer à l'API une valeur déjà validée côté navigateur.
 * `now` est injectable pour tester la borne d'âge.
 */
export const birthDateSchema = (now: Date = new Date()) =>
  z
    .union(
      [
        z.object({
          day: datePart.min(1, 'birthDate.invalid').max(31, 'birthDate.invalid'),
          month: datePart.min(1, 'birthDate.invalid').max(12, 'birthDate.invalid'),
          year: datePart.min(MIN_YEAR, 'birthDate.invalid'),
        }),
        z
          .string()
          .regex(ISO_DATE, 'birthDate.invalid')
          .transform((iso) => {
            const [, year, month, day] = ISO_DATE.exec(iso)!;
            return { day: Number(day), month: Number(month), year: Number(year) };
          }),
      ],
      'birthDate.invalid',
    )
    .transform((value, ctx) => {
      const { day, month, year } = value;
      const valid =
        year >= MIN_YEAR &&
        year <= now.getUTCFullYear() - MIN_AGE_YEARS &&
        month >= 1 &&
        month <= 12 &&
        day >= 1 &&
        day <= daysInMonth(year, month);
      if (!valid) {
        ctx.addIssue({ code: 'custom', message: 'birthDate.invalid' });
        return z.NEVER;
      }
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${year}-${pad(month)}-${pad(day)}`;
    });

export const recoveryAnswerSchema = z.object({
  question: recoveryQuestionSchema,
  answer: z
    .string()
    .min(1, 'answer.required')
    .max(80, 'answer.tooLong')
    .refine((a) => normalizeAnswer(a).length >= 2, 'answer.tooShort'),
});
export type RecoveryAnswer = z.infer<typeof recoveryAnswerSchema>;

/** Liste de réponses : questions toutes différentes, au moins `min` réponses. */
export const recoveryAnswersSchema = (min: number) =>
  z
    .array(recoveryAnswerSchema)
    .min(min, 'answers.tooFew')
    .max(RECOVERY_QUESTIONS.length)
    .refine(
      (list) => new Set(list.map((a) => a.question)).size === list.length,
      'answers.duplicateQuestion',
    );
