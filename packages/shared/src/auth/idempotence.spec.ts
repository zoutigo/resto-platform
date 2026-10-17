import { describe, expect, it } from 'vitest';
import {
  addEmailSchema,
  addPhoneSchema,
  addStaffSchema,
  changePinSchema,
  changeStaffRoleSchema,
  completeRecoverySchema,
  confirmEmailSchema,
  createRestaurantSchema,
  forgotSchema,
  loginEmailSchema,
  loginPhoneSchema,
  recoverEmailSchema,
  recoverWithCodeSchema,
  recoverWithQuestionsSchema,
  registerCustomerSchema,
  registerEmailSchema,
  registerOwnerSchema,
  resendRegistrationSchema,
  verifyRegistrationSchema,
} from './index';

/**
 * Contrat entre les formulaires et l'API : le navigateur valide avec le schéma partagé puis
 * envoie la valeur TRANSFORMÉE (téléphone normalisé, date ISO, email en minuscules…). L'API
 * doit accepter cette valeur : valider deux fois donne donc le même résultat.
 */
const answers = [{ question: 'BIRTH_CITY', answer: 'Douala' }];
const twoAnswers = [...answers, { question: 'FAVORITE_SPORT', answer: 'Football' }];
const birthDate = { day: '5', month: '3', year: '1990' };

const cases: [string, { parse: (v: unknown) => unknown }, unknown][] = [
  [
    'registerCustomer',
    registerCustomerSchema,
    {
      name: 'Awa Mbarga',
      phone: '677 12 34 56',
      pin: '483920',
      pinConfirm: '483920',
      birthDate,
      recoveryAnswers: answers,
    },
  ],
  [
    'registerOwner',
    registerOwnerSchema,
    {
      firstName: 'Paul',
      lastName: 'Essomba',
      phone: '+237 699 88 77 66',
      pin: '715204',
      pinConfirm: '715204',
      birthDate,
      recoveryAnswers: twoAnswers,
    },
  ],
  ['loginPhone', loginPhoneSchema, { phone: '6.77.12.34.56', pin: '123456' }],
  [
    'recoverWithCode',
    recoverWithCodeSchema,
    {
      phone: '677123456',
      recoveryCode: ' abcd-efgh-jkmn ',
      newPin: '715204',
      newPinConfirm: '715204',
    },
  ],
  [
    'recoverWithQuestions',
    recoverWithQuestionsSchema,
    {
      phone: '677123456',
      birthDate,
      recoveryAnswers: answers,
      newPin: '715204',
      newPinConfirm: '715204',
    },
  ],
  ['completeRecovery', completeRecoverySchema, { phone: '00237677123456', newPin: '715204' }],
  [
    'changePin',
    changePinSchema,
    { currentPin: '483920', newPin: '715204', newPinConfirm: '715204' },
  ],
  [
    'registerEmail',
    registerEmailSchema,
    {
      name: 'Awa',
      email: '  Awa@Gmail.COM ',
      password: 'Soleil-2026',
      passwordConfirm: 'Soleil-2026',
    },
  ],
  ['loginEmail', loginEmailSchema, { email: 'AWA@gmail.com', password: 'x' }],
  ['verifyRegistration', verifyRegistrationSchema, { email: ' A@B.CM ', code: ' 123456 ' }],
  ['resendRegistration', resendRegistrationSchema, { email: 'A@B.CM' }],
  ['forgot', forgotSchema, { email: 'A@B.CM', locale: 'en' }],
  [
    'recoverEmail (mot de passe)',
    recoverEmailSchema,
    { email: 'A@B.CM', code: '123456', newPassword: 'Soleil-2026' },
  ],
  [
    'recoverEmail (PIN)',
    recoverEmailSchema,
    { email: 'A@B.CM', code: '123456', newPin: '715204', newPinConfirm: '715204' },
  ],
  ['addEmail', addEmailSchema, { email: ' A@B.CM ' }],
  ['confirmEmail', confirmEmailSchema, { email: 'A@B.CM', code: '123456' }],
  ['addPhone', addPhoneSchema, { phone: '677 12 34 56' }],
  [
    'createRestaurant',
    createRestaurantSchema,
    { name: '  Chez Mama ', city: ' Douala ', address: ' Akwa ' },
  ],
  ['addStaff', addStaffSchema, { name: ' Jean Nkoulou ', phone: '655 11 22 33', role: 'WAITER' }],
  ['changeStaffRole', changeStaffRoleSchema, { role: 'CASHIER' }],
];

describe('contrat formulaire → API : valider deux fois donne le même résultat', () => {
  it.each(cases)('%s', (_name, schema, input) => {
    const once = schema.parse(input);
    expect(schema.parse(once)).toEqual(once);
  });
});
