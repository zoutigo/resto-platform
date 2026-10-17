import { describe, expect, it } from 'vitest';
import {
  completeRecoverySchema,
  recoverWithCodeSchema,
  recoverWithQuestionsSchema,
  regenerateRecoveryCodeSchema,
} from './recover.js';

const issues = (r: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  r.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? [];

describe('recoverWithCodeSchema', () => {
  const ok = {
    phone: '677 12 34 56',
    recoveryCode: 'abcd-efgh-jkmn',
    newPin: '715204',
    newPinConfirm: '715204',
  };

  it('accepte et normalise le téléphone', () => {
    expect(recoverWithCodeSchema.parse(ok).phone).toBe('+237677123456');
  });

  it.each(['', 'ABCD', 'x'.repeat(21)])('refuse le code « %s »', (code) => {
    expect(recoverWithCodeSchema.safeParse({ ...ok, recoveryCode: code }).success).toBe(false);
  });

  it('refuse un PIN faible, une confirmation différente et la fin du téléphone', () => {
    expect(
      issues(recoverWithCodeSchema.safeParse({ ...ok, newPin: '123456', newPinConfirm: '123456' })),
    ).toContain('newPin:pin.weak');
    expect(issues(recoverWithCodeSchema.safeParse({ ...ok, newPinConfirm: '715205' }))).toContain(
      'newPinConfirm:pin.mismatch',
    );
    expect(
      issues(
        recoverWithCodeSchema.safeParse({
          ...ok,
          phone: '677715204',
          newPin: '715204',
          newPinConfirm: '715204',
        }),
      ),
    ).toContain('newPin:pin.weak');
  });
});

describe('recoverWithQuestionsSchema', () => {
  const ok = {
    phone: '677123456',
    birthDate: { day: 5, month: 3, year: 1990 },
    recoveryAnswers: [{ question: 'BIRTH_CITY', answer: 'Douala' }],
    newPin: '715204',
    newPinConfirm: '715204',
  };

  it('produit une date ISO', () => {
    expect(recoverWithQuestionsSchema.parse(ok).birthDate).toBe('1990-03-05');
  });

  it('exige au moins une réponse, sans doublon de question', () => {
    expect(recoverWithQuestionsSchema.safeParse({ ...ok, recoveryAnswers: [] }).success).toBe(
      false,
    );
    const dup = [
      { question: 'BIRTH_CITY', answer: 'Douala' },
      { question: 'BIRTH_CITY', answer: 'Yaoundé' },
    ];
    expect(recoverWithQuestionsSchema.safeParse({ ...ok, recoveryAnswers: dup }).success).toBe(
      false,
    );
  });

  it('refuse une date impossible', () => {
    expect(
      recoverWithQuestionsSchema.safeParse({ ...ok, birthDate: { day: 31, month: 2, year: 1990 } })
        .success,
    ).toBe(false);
  });
});

describe('completeRecoverySchema / regenerateRecoveryCodeSchema', () => {
  it('ne juge que le format du PIN (il a été validé au départ)', () => {
    expect(completeRecoverySchema.safeParse({ phone: '677123456', newPin: '123456' }).success).toBe(
      true,
    );
    expect(completeRecoverySchema.safeParse({ phone: '677123456', newPin: '12345' }).success).toBe(
      false,
    );
  });

  it('exige un PIN bien formé pour régénérer le code', () => {
    expect(regenerateRecoveryCodeSchema.safeParse({ pin: '483920' }).success).toBe(true);
    expect(regenerateRecoveryCodeSchema.safeParse({ pin: 'abc' }).success).toBe(false);
  });
});
