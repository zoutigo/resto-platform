import { describe, expect, it } from 'vitest';
import {
  addEmailSchema,
  addPhoneSchema,
  confirmEmailSchema,
  emailCodeSchema,
  emailSchema,
  forgotSchema,
  googleLoginSchema,
  isWeakPassword,
  loginEmailSchema,
  passwordSchema,
  recoverEmailSchema,
  registerEmailSchema,
} from './email.js';

const issues = (r: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  r.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? [];

describe('emailSchema', () => {
  it('normalise : espaces et casse', () => {
    expect(emailSchema.parse('  Awa.MBARGA@Gmail.COM ')).toBe('awa.mbarga@gmail.com');
  });

  it.each([
    '',
    'awa',
    'awa@',
    '@gmail.com',
    'awa@gmail',
    'a b@gmail.com',
    `${'a'.repeat(250)}@x.cm`,
  ])('refuse « %s »', (value) => {
    expect(emailSchema.safeParse(value).success).toBe(false);
  });
});

describe('passwordSchema', () => {
  it('accepte un mot de passe correct', () => {
    expect(passwordSchema.safeParse('Soleil-du-Cameroun-7').success).toBe(true);
    expect(passwordSchema.safeParse('abcd1234').success).toBe(true);
  });

  it.each([
    'court',
    '1234567',
    'password',
    'PASSWORD',
    '12345678',
    'azerty123',
    'aaaaaaaa',
    'x'.repeat(129),
  ])('refuse « %s »', (value) => {
    expect(passwordSchema.safeParse(value).success).toBe(false);
  });

  it('signale tooShort / weak / tooLong', () => {
    expect(issues(passwordSchema.safeParse('abc'))).toContain(':password.tooShort');
    expect(issues(passwordSchema.safeParse('password'))).toContain(':password.weak');
    expect(isWeakPassword('Password123')).toBe(true); // insensible à la casse
    expect(isWeakPassword('Soleil-2026')).toBe(false);
  });
});

describe('emailCodeSchema', () => {
  it.each(['123456', ' 000000 '])('accepte %s', (c) =>
    expect(emailCodeSchema.safeParse(c).success).toBe(true),
  );
  it.each(['12345', '1234567', 'abcdef', '12 345', ''])('refuse « %s »', (c) =>
    expect(emailCodeSchema.safeParse(c).success).toBe(false),
  );
});

describe('registerEmailSchema', () => {
  const ok = {
    name: 'Awa Mbarga',
    email: 'Awa@Gmail.com',
    password: 'Soleil-2026',
    passwordConfirm: 'Soleil-2026',
  };

  it('valide, normalise et fixe la langue par défaut', () => {
    const r = registerEmailSchema.parse(ok);
    expect(r.email).toBe('awa@gmail.com');
    expect(r.locale).toBe('fr');
  });

  it('refuse une confirmation différente', () => {
    expect(issues(registerEmailSchema.safeParse({ ...ok, passwordConfirm: 'autre' }))).toContain(
      'passwordConfirm:password.mismatch',
    );
  });

  it('refuse un nom trop court, une langue inconnue', () => {
    expect(registerEmailSchema.safeParse({ ...ok, name: 'A' }).success).toBe(false);
    expect(registerEmailSchema.safeParse({ ...ok, locale: 'de' }).success).toBe(false);
  });
});

describe('loginEmailSchema / forgotSchema / addEmailSchema', () => {
  it('login : ne juge pas la solidité du mot de passe', () => {
    expect(loginEmailSchema.safeParse({ email: 'a@b.cm', password: 'x' }).success).toBe(true);
    expect(loginEmailSchema.safeParse({ email: 'a@b.cm', password: '' }).success).toBe(false);
  });

  it('forgot et addEmail normalisent l’email', () => {
    expect(forgotSchema.parse({ email: 'A@B.CM' }).email).toBe('a@b.cm');
    expect(addEmailSchema.parse({ email: ' A@B.CM ' }).locale).toBe('fr');
  });
});

describe('recoverEmailSchema', () => {
  const base = { email: 'a@b.cm', code: '123456' };

  it('accepte un nouveau mot de passe seul', () => {
    expect(recoverEmailSchema.safeParse({ ...base, newPassword: 'Soleil-2026' }).success).toBe(
      true,
    );
  });

  it('accepte un nouveau PIN confirmé seul', () => {
    expect(
      recoverEmailSchema.safeParse({ ...base, newPin: '715204', newPinConfirm: '715204' }).success,
    ).toBe(true);
  });

  it('refuse les deux à la fois ou aucun', () => {
    expect(
      issues(
        recoverEmailSchema.safeParse({
          ...base,
          newPassword: 'Soleil-2026',
          newPin: '715204',
          newPinConfirm: '715204',
        }),
      ),
    ).toContain('newPassword:recover.chooseOne');
    expect(issues(recoverEmailSchema.safeParse(base))).toContain('newPassword:recover.chooseOne');
  });

  it('refuse un PIN faible ou non confirmé', () => {
    expect(
      recoverEmailSchema.safeParse({ ...base, newPin: '123456', newPinConfirm: '123456' }).success,
    ).toBe(false);
    expect(
      issues(recoverEmailSchema.safeParse({ ...base, newPin: '715204', newPinConfirm: '715205' })),
    ).toContain('newPinConfirm:pin.mismatch');
  });
});

describe('confirmEmailSchema', () => {
  it('exige l’email et le code', () => {
    expect(confirmEmailSchema.parse({ email: 'A@B.CM', code: '123456' })).toEqual({
      email: 'a@b.cm',
      code: '123456',
    });
    expect(confirmEmailSchema.safeParse({ code: '123456' }).success).toBe(false);
    expect(confirmEmailSchema.safeParse({ email: 'a@b.cm', code: '12' }).success).toBe(false);
  });
});

describe('addPhoneSchema / googleLoginSchema', () => {
  it('normalise le téléphone', () => {
    expect(addPhoneSchema.parse({ phone: '677 12 34 56' }).phone).toBe('+237677123456');
    expect(addPhoneSchema.safeParse({ phone: '123' }).success).toBe(false);
  });

  it('exige un jeton Google plausible', () => {
    expect(googleLoginSchema.safeParse({ idToken: 'x'.repeat(100) }).success).toBe(true);
    expect(googleLoginSchema.safeParse({ idToken: 'court' }).success).toBe(false);
  });
});
