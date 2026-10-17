import { describe, expect, it } from 'vitest';
import {
  changePinSchema,
  loginPhoneSchema,
  registerCustomerSchema,
  registerOwnerSchema,
} from './register.js';

const customer = {
  name: 'Awa Mbarga',
  phone: '677 12 34 56',
  pin: '483920',
  pinConfirm: '483920',
  birthDate: { day: 5, month: 3, year: 1990 },
  recoveryAnswers: [{ question: 'BIRTH_CITY', answer: 'Douala' }],
};

const owner = {
  firstName: 'Paul',
  lastName: 'Essomba',
  phone: '699887766',
  pin: '715204',
  pinConfirm: '715204',
  birthDate: { day: 12, month: 11, year: 1980 },
  recoveryAnswers: [
    { question: 'BIRTH_CITY', answer: 'Bafoussam' },
    { question: 'CUSTOM_SECRET', answer: 'mon grand-père' },
  ],
};

const issues = (r: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => r.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? [];

describe('registerCustomerSchema', () => {
  it('normalise téléphone et date', () => {
    const r = registerCustomerSchema.parse(customer);
    expect(r.phone).toBe('+237677123456');
    expect(r.birthDate).toBe('1990-03-05');
  });

  it('refuse deux PIN différents', () => {
    const r = registerCustomerSchema.safeParse({ ...customer, pinConfirm: '483921' });
    expect(issues(r)).toContain('pinConfirm:pin.mismatch');
  });

  it('refuse un PIN faible', () => {
    const r = registerCustomerSchema.safeParse({
      ...customer,
      pin: '123456',
      pinConfirm: '123456',
    });
    expect(issues(r)).toContain('pin:pin.weak');
  });

  it('refuse un PIN égal aux 6 derniers chiffres du téléphone', () => {
    const r = registerCustomerSchema.safeParse({
      ...customer,
      phone: '677483920',
      pin: '483920',
      pinConfirm: '483920',
    });
    expect(issues(r)).toContain('pin:pin.weak');
  });

  it('refuse un téléphone invalide', () => {
    const r = registerCustomerSchema.safeParse({ ...customer, phone: '12345' });
    expect(issues(r)).toContain('phone:phone.invalid');
  });

  it('exige au moins une réponse secrète', () => {
    const r = registerCustomerSchema.safeParse({ ...customer, recoveryAnswers: [] });
    expect(r.success).toBe(false);
  });

  it('refuse un nom trop court', () => {
    expect(registerCustomerSchema.safeParse({ ...customer, name: 'A' }).success).toBe(false);
  });
});

describe('registerOwnerSchema', () => {
  it('accepte une inscription complète', () => {
    expect(registerOwnerSchema.safeParse(owner).success).toBe(true);
  });

  it('exige deux réponses secrètes', () => {
    const r = registerOwnerSchema.safeParse({
      ...owner,
      recoveryAnswers: owner.recoveryAnswers.slice(0, 1),
    });
    expect(r.success).toBe(false);
    expect(issues(r)).toContain('recoveryAnswers:answers.tooFew');
  });

  it('exige prénom et nom', () => {
    expect(registerOwnerSchema.safeParse({ ...owner, firstName: '' }).success).toBe(false);
    expect(registerOwnerSchema.safeParse({ ...owner, lastName: '' }).success).toBe(false);
  });
});

describe('loginPhoneSchema', () => {
  it('accepte un PIN faible mais bien formé', () => {
    expect(loginPhoneSchema.parse({ phone: '677123456', pin: '123456' }).phone).toBe(
      '+237677123456',
    );
  });

  it('refuse un PIN mal formé', () => {
    expect(loginPhoneSchema.safeParse({ phone: '677123456', pin: '12345' }).success).toBe(false);
  });
});

describe('changePinSchema', () => {
  const ok = { currentPin: '483920', newPin: '715204', newPinConfirm: '715204' };

  it('accepte un changement valide', () => {
    expect(changePinSchema.safeParse(ok).success).toBe(true);
  });

  it('refuse une confirmation différente', () => {
    expect(issues(changePinSchema.safeParse({ ...ok, newPinConfirm: '715205' }))).toContain(
      'newPinConfirm:pin.mismatch',
    );
  });

  it('refuse un nouveau PIN faible', () => {
    const r = changePinSchema.safeParse({ ...ok, newPin: '123456', newPinConfirm: '123456' });
    expect(issues(r)).toContain('newPin:pin.weak');
  });

  it('refuse de reprendre le même PIN', () => {
    const r = changePinSchema.safeParse({ ...ok, newPin: '483920', newPinConfirm: '483920' });
    expect(issues(r)).toContain('newPin:pin.unchanged');
  });
});
