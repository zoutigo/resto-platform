import { describe, expect, it } from 'vitest';
import { birthDateSchema, normalizeAnswer, recoveryAnswersSchema } from './recovery.js';

describe('normalizeAnswer', () => {
  it('ignore casse, accents, espaces et ponctuation', () => {
    expect(normalizeAnswer('Yaoundé')).toBe('yaounde');
    expect(normalizeAnswer(' YAOUNDE ')).toBe('yaounde');
    expect(normalizeAnswer('Foot-ball')).toBe(normalizeAnswer('football'));
    expect(normalizeAnswer("N'Gaoundéré")).toBe('ngaoundere');
  });

  it('réduit les lettres doublées', () => {
    expect(normalizeAnswer('Football')).toBe('fotbal');
    expect(normalizeAnswer('Mississippi')).toBe('misisipi');
  });

  it('distingue des réponses différentes', () => {
    expect(normalizeAnswer('Douala')).not.toBe(normalizeAnswer('Yaoundé'));
  });

  it('garde les chiffres', () => {
    expect(normalizeAnswer('Mot 2 passe')).toBe('mot2pase');
  });
});

describe('birthDateSchema', () => {
  const now = new Date('2026-10-17T00:00:00Z');
  const schema = birthDateSchema(now);

  it('produit une date ISO', () => {
    expect(schema.parse({ day: 5, month: 3, year: 1990 })).toBe('1990-03-05');
  });

  it('accepte les chaînes des menus déroulants', () => {
    expect(schema.parse({ day: '1', month: '12', year: '1985' })).toBe('1985-12-01');
  });

  it("accepte le 29 février d'une année bissextile seulement", () => {
    expect(schema.safeParse({ day: 29, month: 2, year: 2000 }).success).toBe(true);
    expect(schema.safeParse({ day: 29, month: 2, year: 2001 }).success).toBe(false);
    expect(schema.safeParse({ day: 29, month: 2, year: 1900 }).success).toBe(false);
  });

  it.each([
    { day: 31, month: 4, year: 1990 },
    { day: 0, month: 4, year: 1990 },
    { day: 1, month: 13, year: 1990 },
    { day: 1, month: 1, year: 1899 },
    { day: 1, month: 1, year: 2020 }, // moins de 10 ans
    { day: 'x', month: 1, year: 1990 },
  ])('refuse %j', (value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });

  it("accepte exactement l'année limite", () => {
    expect(schema.safeParse({ day: 1, month: 1, year: 2016 }).success).toBe(true);
  });
});

describe('birthDateSchema — idempotence', () => {
  const schema = birthDateSchema(new Date('2026-10-17T00:00:00Z'));

  it('accepte sa propre sortie (valider deux fois donne le même résultat)', () => {
    const once = schema.parse({ day: '5', month: '3', year: '1990' });
    expect(once).toBe('1990-03-05');
    expect(schema.parse(once)).toBe(once);
  });

  it.each([
    '1990-3-5',
    '90-03-05',
    '1990/03/05',
    '1990-02-30',
    '1990-13-01',
    '2020-01-01',
    '1899-12-31',
    '',
    'abc',
  ])('refuse la chaîne « %s »', (value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });

  it('refuse les types inattendus', () => {
    for (const bad of [null, undefined, 19900305, [], true])
      expect(schema.safeParse(bad).success).toBe(false);
  });
});

describe("messages d'erreur des formulaires", () => {
  it('un menu de date laissé vide renvoie birthDate.invalid, pas un message technique', () => {
    const r = birthDateSchema(new Date('2026-10-17')).safeParse({ day: '', month: '', year: '' });
    expect(r.success).toBe(false);
    expect([...new Set(r.error?.issues.map((i) => i.message))]).toEqual(['birthDate.invalid']);
  });

  it('une question non choisie renvoie question.required', () => {
    const r = recoveryAnswersSchema(1).safeParse([{ question: '', answer: 'x' }]);
    expect(r.error?.issues.map((i) => i.message)).toContain('question.required');
  });
});

describe('recoveryAnswersSchema', () => {
  const answer = (question: string, text = 'réponse') => ({ question, answer: text });

  it('accepte le nombre minimum de réponses', () => {
    expect(recoveryAnswersSchema(1).safeParse([answer('BIRTH_CITY', 'Douala')]).success).toBe(true);
  });

  it('refuse trop peu de réponses', () => {
    const r = recoveryAnswersSchema(2).safeParse([answer('BIRTH_CITY', 'Douala')]);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('answers.tooFew');
  });

  it('refuse deux fois la même question', () => {
    const r = recoveryAnswersSchema(1).safeParse([
      answer('BIRTH_CITY', 'Douala'),
      answer('BIRTH_CITY', 'Yaoundé'),
    ]);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('answers.duplicateQuestion');
  });

  it('refuse une question inconnue', () => {
    expect(recoveryAnswersSchema(1).safeParse([answer('PET_NAME')]).success).toBe(false);
  });

  it.each(['', ' ', '!!', 'a', 'aa'])(
    'refuse la réponse « %s » (trop courte une fois normalisée)',
    (text) => {
      expect(recoveryAnswersSchema(1).safeParse([answer('CUSTOM_SECRET', text)]).success).toBe(
        false,
      );
    },
  );
});
