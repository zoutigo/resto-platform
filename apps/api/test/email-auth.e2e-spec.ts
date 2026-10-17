import type { INestApplication } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GOOGLE_VERIFIER, type GoogleProfile } from '../src/modules/auth/google.verifier.js';
import {
  EMAIL_CHANNEL,
  type MemoryEmailChannel,
} from '../src/modules/notifications/email.channel.js';
import { PrismaService } from '../src/prisma.service.js';
import {
  type Audience,
  PIN,
  client,
  cookieValue,
  customerBody,
  uniqueEmail,
  uniquePhone,
} from './auth-helpers.js';
import { createTestApp } from './helpers.js';

const PASSWORD = 'Soleil-2026';
const NEW_PASSWORD = 'Nouveau-mdp-9';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Faux vérificateur Google : un jeton de test correspond à un profil. */
class FakeGoogleVerifier {
  readonly profiles = new Map<string, GoogleProfile>();

  async verify(idToken: string): Promise<GoogleProfile> {
    const profile = this.profiles.get(idToken);
    if (!profile) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'google.invalidToken',
      });
    }
    return profile;
  }

  register(email: string | null, over: Partial<GoogleProfile> = {}) {
    const token = `google-token-${Math.random().toString(36).slice(2)}-padding-padding`;
    this.profiles.set(token, {
      sub: `sub-${Math.random().toString(36).slice(2)}`,
      email,
      emailVerified: true,
      name: 'Awa Mbarga',
      ...over,
    });
    return token;
  }
}

describe('Email, Google et rattachements (vraie base resto_test)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mails: MemoryEmailChannel;
  const google = new FakeGoogleVerifier();

  beforeAll(async () => {
    app = await createTestApp((b) => b.overrideProvider(GOOGLE_VERIFIER).useValue(google));
    prisma = app.get(PrismaService);
    mails = app.get<MemoryEmailChannel>(EMAIL_CHANNEL);
  });

  afterAll(async () => {
    await app.close();
  });

  const cookieOf = (audience: Audience) => `resto_${audience}_rt`;

  /** Inscription par email complète (étape 1 + code). */
  async function signUpByEmail(
    audience: Audience,
    email = uniqueEmail(),
    over: Record<string, unknown> = {},
  ) {
    const http = client(app);
    await http
      .post(`/auth/${audience}/register-email`)
      .send({ name: 'Awa Mbarga', email, password: PASSWORD, passwordConfirm: PASSWORD, ...over })
      .expect(202);
    const code = mails.lastCodeTo(email)!;
    const res = await http
      .post(`/auth/${audience}/register-email/verify`)
      .send({ email, code })
      .expect(201);
    return {
      http,
      email,
      userId: res.body.user.id as string,
      token: res.body.accessToken as string,
      refresh: cookieValue(res, cookieOf(audience)) as string,
    };
  }

  describe.each<Audience>(['staff', 'customer'])('espace %s', (audience) => {
    describe('inscription par email', () => {
      it('ne crée le compte qu’après le code, puis ouvre la session', async () => {
        const email = uniqueEmail();
        const http = client(app);
        const start = await http
          .post(`/auth/${audience}/register-email`)
          .send({
            name: 'Awa Mbarga',
            email: email.toUpperCase(),
            password: PASSWORD,
            passwordConfirm: PASSWORD,
          })
          .expect(202);
        expect(start.body).toEqual({ sent: true });
        expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
        expect(mails.lastTo(email)?.subject).toBe('Votre code de vérification');

        const code = mails.lastCodeTo(email)!;
        const done = await http
          .post(`/auth/${audience}/register-email/verify`)
          .send({ email, code })
          .expect(201);
        expect(done.body.user).toMatchObject({ email, emailVerified: true, phone: null });
        expect(cookieValue(done, cookieOf(audience))).toBeDefined();

        const user = await prisma.user.findUniqueOrThrow({
          where: { email },
          include: { credentials: true },
        });
        expect(user.credentials).toHaveLength(1);
        expect(user.credentials[0]).toMatchObject({ type: 'PASSWORD' });
        expect(user.credentials[0]?.hash.startsWith('$argon2id$')).toBe(true);
        expect(user.credentials[0]?.hash).not.toContain(PASSWORD);

        const me = await http
          .get(`/auth/${audience}/me`)
          .set(bearer(done.body.accessToken))
          .expect(200);
        expect(me.body.user.email).toBe(email);
      });

      it('envoie le message en anglais sur demande', async () => {
        const email = uniqueEmail();
        await client(app)
          .post(`/auth/${audience}/register-email`)
          .send({
            name: 'Awa Mbarga',
            email,
            password: PASSWORD,
            passwordConfirm: PASSWORD,
            locale: 'en',
          })
          .expect(202);
        expect(mails.lastTo(email)?.subject).toBe('Your verification code');
      });

      it.each([
        ['email invalide', { email: 'pas-un-email' }],
        ['mot de passe faible', { password: 'password', passwordConfirm: 'password' }],
        ['mot de passe trop court', { password: 'abc', passwordConfirm: 'abc' }],
        ['confirmation différente', { passwordConfirm: 'Autre-mdp-1' }],
        ['nom trop court', { name: 'A' }],
      ])('400 : %s (rien n’est envoyé)', async (_l, over) => {
        const email = uniqueEmail();
        const before = mails.sent.length;
        await client(app)
          .post(`/auth/${audience}/register-email`)
          .send({
            name: 'Awa Mbarga',
            email,
            password: PASSWORD,
            passwordConfirm: PASSWORD,
            ...over,
          })
          .expect(400);
        expect(mails.sent.length).toBe(before);
      });

      it('refuse un email déjà rattaché à un compte (409)', async () => {
        const { email } = await signUpByEmail(audience);
        await client(app)
          .post(`/auth/${audience}/register-email`)
          .send({ name: 'Autre Personne', email, password: PASSWORD, passwordConfirm: PASSWORD })
          .expect(409);
      });

      it('un mauvais code est refusé (400) et ne crée rien', async () => {
        const email = uniqueEmail();
        const http = client(app);
        await http
          .post(`/auth/${audience}/register-email`)
          .send({ name: 'Awa Mbarga', email, password: PASSWORD, passwordConfirm: PASSWORD })
          .expect(202);
        const code = mails.lastCodeTo(email)!;
        const wrong = code === '000000' ? '111111' : '000000';
        const res = await http
          .post(`/auth/${audience}/register-email/verify`)
          .send({ email, code: wrong })
          .expect(400);
        expect(res.body.message).toBe('emailCode.invalid');
        expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
        // Le bon code fonctionne encore.
        await http
          .post(`/auth/${audience}/register-email/verify`)
          .send({ email, code })
          .expect(201);
      });

      it('le code est à usage unique', async () => {
        const email = uniqueEmail();
        const http = client(app);
        await http
          .post(`/auth/${audience}/register-email`)
          .send({ name: 'Awa Mbarga', email, password: PASSWORD, passwordConfirm: PASSWORD })
          .expect(202);
        const code = mails.lastCodeTo(email)!;
        await http
          .post(`/auth/${audience}/register-email/verify`)
          .send({ email, code })
          .expect(201);
        await http
          .post(`/auth/${audience}/register-email/verify`)
          .send({ email, code })
          .expect(400);
      });

      it('un code expiré est refusé', async () => {
        const email = uniqueEmail();
        const http = client(app);
        await http
          .post(`/auth/${audience}/register-email`)
          .send({ name: 'Awa Mbarga', email, password: PASSWORD, passwordConfirm: PASSWORD })
          .expect(202);
        await prisma.emailCode.updateMany({
          where: { email },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
        await http
          .post(`/auth/${audience}/register-email/verify`)
          .send({ email, code: mails.lastCodeTo(email) })
          .expect(400);
      });

      it('5 essais épuisés : le code meurt, même le bon', async () => {
        const email = uniqueEmail();
        const http = client(app);
        await http
          .post(`/auth/${audience}/register-email`)
          .send({ name: 'Awa Mbarga', email, password: PASSWORD, passwordConfirm: PASSWORD })
          .expect(202);
        const code = mails.lastCodeTo(email)!;
        await prisma.emailCode.updateMany({ where: { email }, data: { attempts: 5 } });
        await http
          .post(`/auth/${audience}/register-email/verify`)
          .send({ email, code })
          .expect(400);
        expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
      });

      it('ralentit les essais : après 5 mauvais codes, 429 même avec le bon', async () => {
        const email = uniqueEmail();
        const http = client(app);
        await http
          .post(`/auth/${audience}/register-email`)
          .send({ name: 'Awa Mbarga', email, password: PASSWORD, passwordConfirm: PASSWORD })
          .expect(202);
        const code = mails.lastCodeTo(email)!;
        const wrong = code === '000000' ? '111111' : '000000';
        for (let i = 0; i < 5; i++) {
          await http
            .post(`/auth/${audience}/register-email/verify`)
            .send({ email, code: wrong })
            .expect(400);
        }
        const blocked = await http
          .post(`/auth/${audience}/register-email/verify`)
          .send({ email, code })
          .expect(429);
        expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      });

      it('un nouveau code remplace le précédent', async () => {
        const email = uniqueEmail();
        const http = client(app);
        const start = () =>
          http
            .post(`/auth/${audience}/register-email`)
            .send({ name: 'Awa Mbarga', email, password: PASSWORD, passwordConfirm: PASSWORD })
            .expect(202);
        await start();
        const first = mails.lastCodeTo(email)!;
        await start();
        const second = mails.lastCodeTo(email)!;
        if (first !== second) {
          await http
            .post(`/auth/${audience}/register-email/verify`)
            .send({ email, code: first })
            .expect(400);
        }
        await http
          .post(`/auth/${audience}/register-email/verify`)
          .send({ email, code: second })
          .expect(201);
      });

      it('protège contre le « squat » d’adresse : seul le propriétaire de la boîte crée le compte', async () => {
        const victim = uniqueEmail();
        const attacker = client(app);
        // L'attaquant lance l'inscription avec l'adresse de la victime...
        await attacker
          .post(`/auth/${audience}/register-email`)
          .send({
            name: 'Attaquant',
            email: victim,
            password: 'Mdp-attaquant-1',
            passwordConfirm: 'Mdp-attaquant-1',
          })
          .expect(202);
        expect(await prisma.user.findUnique({ where: { email: victim } })).toBeNull();
        // ... mais ne reçoit jamais le code. La victime s'inscrit normalement ensuite.
        const done = await signUpByEmail(audience, victim, { name: 'Vraie Victime' });
        const user = await prisma.user.findUniqueOrThrow({ where: { id: done.userId } });
        expect(user.name).toBe('Vraie Victime');
        await client(app)
          .post(`/auth/${audience}/login-email`)
          .send({ email: victim, password: 'Mdp-attaquant-1' })
          .expect(401);
        await client(app)
          .post(`/auth/${audience}/login-email`)
          .send({ email: victim, password: PASSWORD })
          .expect(200);
      });

      it('un code d’inscription lancé dans l’autre espace ne sert pas ici', async () => {
        const other: Audience = audience === 'staff' ? 'customer' : 'staff';
        const email = uniqueEmail();
        const http = client(app);
        await http
          .post(`/auth/${other}/register-email`)
          .send({ name: 'Awa Mbarga', email, password: PASSWORD, passwordConfirm: PASSWORD })
          .expect(202);
        await http
          .post(`/auth/${audience}/register-email/verify`)
          .send({ email, code: mails.lastCodeTo(email) })
          .expect(400);
        expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
      });

      it('renvoie un code : le nouveau marche, et rien ne fuit pour une adresse sans inscription', async () => {
        const email = uniqueEmail();
        const http = client(app);
        await http
          .post(`/auth/${audience}/register-email`)
          .send({ name: 'Awa Mbarga', email, password: PASSWORD, passwordConfirm: PASSWORD })
          .expect(202);
        const before = mails.sent.length;
        await http.post(`/auth/${audience}/register-email/resend`).send({ email }).expect(202);
        expect(mails.sent.length).toBe(before + 1);
        await http
          .post(`/auth/${audience}/register-email/verify`)
          .send({ email, code: mails.lastCodeTo(email) })
          .expect(201);

        const stranger = uniqueEmail();
        const count = mails.sent.length;
        const res = await http
          .post(`/auth/${audience}/register-email/resend`)
          .send({ email: stranger })
          .expect(202);
        expect(res.body).toEqual({ sent: true });
        expect(mails.sent.length).toBe(count);
      });

      it('limite les envois à 3 par adresse et par heure', async () => {
        const email = uniqueEmail();
        const http = client(app);
        const start = () =>
          http
            .post(`/auth/${audience}/register-email`)
            .send({ name: 'Awa Mbarga', email, password: PASSWORD, passwordConfirm: PASSWORD });
        for (let i = 0; i < 3; i++) await start().expect(202);
        const blocked = await start().expect(429);
        expect(blocked.headers['retry-after']).toBeDefined();
      });
    });

    describe('connexion par email', () => {
      it('connecte avec le bon mot de passe (adresse insensible à la casse)', async () => {
        const { email } = await signUpByEmail(audience);
        const res = await client(app)
          .post(`/auth/${audience}/login-email`)
          .send({ email: email.toUpperCase(), password: PASSWORD })
          .expect(200);
        expect(res.body.accessToken).toEqual(expect.any(String));
        expect(res.body.mustChangePin).toBe(false);
        expect(cookieValue(res, cookieOf(audience))).toBeDefined();
      });

      it('401 identique pour mauvais mot de passe, email inconnu et compte sans mot de passe', async () => {
        const { email } = await signUpByEmail(audience);
        const phoneAccount = await client(app)
          .post(`/auth/${audience}/register`)
          .send(
            audience === 'staff'
              ? {
                  firstName: 'Paul',
                  lastName: 'Essomba',
                  phone: uniquePhone(),
                  pin: PIN,
                  pinConfirm: PIN,
                  birthDate: { day: 12, month: 11, year: 1980 },
                  recoveryAnswers: [
                    { question: 'BIRTH_CITY', answer: 'Bafoussam' },
                    { question: 'FAVORITE_SPORT', answer: 'Football' },
                  ],
                }
              : customerBody(),
          )
          .expect(201);
        expect(phoneAccount.body.user.email).toBeNull();

        const attempt = (body: object) =>
          client(app).post(`/auth/${audience}/login-email`).send(body);
        const wrong = await attempt({ email, password: 'Mauvais-mdp-1' }).expect(401);
        const unknown = await attempt({ email: uniqueEmail(), password: PASSWORD }).expect(401);
        expect(wrong.body).toEqual(unknown.body);
        expect(wrong.body.message).toBe('auth.invalidCredentials');
      });

      it('ralentit après 5 échecs (429), même avec le bon mot de passe', async () => {
        const { email } = await signUpByEmail(audience);
        const http = client(app);
        for (let i = 0; i < 5; i++) {
          await http
            .post(`/auth/${audience}/login-email`)
            .send({ email, password: 'Mauvais-mdp-1' })
            .expect(401);
        }
        const blocked = await http
          .post(`/auth/${audience}/login-email`)
          .send({ email, password: PASSWORD })
          .expect(429);
        expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      });

      it('400 sur une saisie invalide', async () => {
        await client(app)
          .post(`/auth/${audience}/login-email`)
          .send({ email: 'x', password: PASSWORD })
          .expect(400);
        await client(app)
          .post(`/auth/${audience}/login-email`)
          .send({ email: uniqueEmail(), password: '' })
          .expect(400);
      });
    });

    describe('mot de passe oublié', () => {
      it('un code par email permet de choisir un nouveau mot de passe', async () => {
        const { email, refresh } = await signUpByEmail(audience);
        const http = client(app);
        const forgot = await http
          .post(`/auth/${audience}/email/forgot`)
          .send({ email })
          .expect(202);
        expect(forgot.body).toEqual({ sent: true });
        expect(mails.lastTo(email)?.subject).toBe('Réinitialisation de votre accès');

        const res = await http
          .post(`/auth/${audience}/recover/email`)
          .send({ email, code: mails.lastCodeTo(email), newPassword: NEW_PASSWORD })
          .expect(200);
        expect(res.body.accessToken).toEqual(expect.any(String));

        await http
          .post(`/auth/${audience}/login-email`)
          .send({ email, password: PASSWORD })
          .expect(401);
        await http
          .post(`/auth/${audience}/login-email`)
          .send({ email, password: NEW_PASSWORD })
          .expect(200);
        // Les anciennes sessions sont coupées.
        await http
          .post(`/auth/${audience}/refresh`)
          .set('Cookie', `${cookieOf(audience)}=${refresh}`)
          .expect(401);
      });

      it('répond pareil (et n’envoie rien) pour une adresse inconnue', async () => {
        const stranger = uniqueEmail();
        const before = mails.sent.length;
        const res = await client(app)
          .post(`/auth/${audience}/email/forgot`)
          .send({ email: stranger })
          .expect(202);
        expect(res.body).toEqual({ sent: true });
        expect(mails.sent.length).toBe(before);
      });

      it('le code est à usage unique et un mauvais code est refusé', async () => {
        const { email } = await signUpByEmail(audience);
        const http = client(app);
        await http.post(`/auth/${audience}/email/forgot`).send({ email }).expect(202);
        const code = mails.lastCodeTo(email)!;
        const wrong = code === '000000' ? '111111' : '000000';
        await http
          .post(`/auth/${audience}/recover/email`)
          .send({ email, code: wrong, newPassword: NEW_PASSWORD })
          .expect(400);
        await http
          .post(`/auth/${audience}/recover/email`)
          .send({ email, code, newPassword: NEW_PASSWORD })
          .expect(200);
        await http
          .post(`/auth/${audience}/recover/email`)
          .send({ email, code, newPassword: 'Encore-un-autre-1' })
          .expect(400);
      });

      it('le code d’une adresse ne sert pas pour une autre', async () => {
        const a = await signUpByEmail(audience);
        const b = await signUpByEmail(audience);
        const http = client(app);
        await http.post(`/auth/${audience}/email/forgot`).send({ email: a.email }).expect(202);
        await http
          .post(`/auth/${audience}/recover/email`)
          .send({ email: b.email, code: mails.lastCodeTo(a.email), newPassword: NEW_PASSWORD })
          .expect(400);
        await http
          .post(`/auth/${audience}/login-email`)
          .send({ email: b.email, password: PASSWORD })
          .expect(200);
      });

      it('400 : ni mot de passe ni PIN, ou les deux, ou mot de passe faible', async () => {
        const { email } = await signUpByEmail(audience);
        const http = client(app);
        await http.post(`/auth/${audience}/email/forgot`).send({ email }).expect(202);
        const code = mails.lastCodeTo(email);
        await http.post(`/auth/${audience}/recover/email`).send({ email, code }).expect(400);
        await http
          .post(`/auth/${audience}/recover/email`)
          .send({
            email,
            code,
            newPassword: NEW_PASSWORD,
            newPin: '715204',
            newPinConfirm: '715204',
          })
          .expect(400);
        await http
          .post(`/auth/${audience}/recover/email`)
          .send({ email, code, newPassword: 'password' })
          .expect(400);
        // Aucune de ces tentatives invalides n'a consommé le code.
        await http
          .post(`/auth/${audience}/recover/email`)
          .send({ email, code, newPassword: NEW_PASSWORD })
          .expect(200);
      });

      it('un compte email seul ne peut pas définir de PIN (pas de téléphone)', async () => {
        const { email } = await signUpByEmail(audience);
        const http = client(app);
        await http.post(`/auth/${audience}/email/forgot`).send({ email }).expect(202);
        const res = await http
          .post(`/auth/${audience}/recover/email`)
          .send({ email, code: mails.lastCodeTo(email), newPin: '715204', newPinConfirm: '715204' })
          .expect(400);
        expect(res.body.message).toBe('recover.pinNeedsPhone');
      });

      it('limite les demandes de code à 3 par adresse et par heure', async () => {
        const { email } = await signUpByEmail(audience);
        const http = client(app);
        // L'inscription a déjà consommé 1 envoi pour cette adresse.
        await http.post(`/auth/${audience}/email/forgot`).send({ email }).expect(202);
        await http.post(`/auth/${audience}/email/forgot`).send({ email }).expect(202);
        await http.post(`/auth/${audience}/email/forgot`).send({ email }).expect(429);
      });
    });

    describe('email rattaché à un compte téléphone + PIN : PIN oublié', () => {
      async function phoneAccountWithEmail() {
        const body = customerBody();
        const http = client(app);
        const reg = await http
          .post(`/auth/${audience}/register`)
          .send(
            audience === 'staff'
              ? {
                  firstName: 'Paul',
                  lastName: 'Essomba',
                  phone: body.phone,
                  pin: PIN,
                  pinConfirm: PIN,
                  birthDate: { day: 12, month: 11, year: 1980 },
                  recoveryAnswers: [
                    { question: 'BIRTH_CITY', answer: 'Bafoussam' },
                    { question: 'FAVORITE_SPORT', answer: 'Football' },
                  ],
                }
              : body,
          )
          .expect(201);
        const token = reg.body.accessToken as string;
        const email = uniqueEmail();
        await http
          .post(`/auth/${audience}/email/add`)
          .set(bearer(token))
          .send({ email })
          .expect(202);
        const confirm = await http
          .post(`/auth/${audience}/email/confirm`)
          .set(bearer(token))
          .send({ email, code: mails.lastCodeTo(email) })
          .expect(200);
        expect(confirm.body.user).toMatchObject({ email, emailVerified: true });
        return { http, phone: body.phone as string, email, token };
      }

      it('le code reçu par email réinitialise le PIN', async () => {
        const { http, phone, email } = await phoneAccountWithEmail();
        await http.post(`/auth/${audience}/email/forgot`).send({ email }).expect(202);
        await http
          .post(`/auth/${audience}/recover/email`)
          .send({ email, code: mails.lastCodeTo(email), newPin: '715204', newPinConfirm: '715204' })
          .expect(200);
        await http.post(`/auth/${audience}/login`).send({ phone, pin: PIN }).expect(401);
        await http.post(`/auth/${audience}/login`).send({ phone, pin: '715204' }).expect(200);
      });

      it('refuse un PIN faible ou non confirmé', async () => {
        const { http, email } = await phoneAccountWithEmail();
        await http.post(`/auth/${audience}/email/forgot`).send({ email }).expect(202);
        const code = mails.lastCodeTo(email);
        await http
          .post(`/auth/${audience}/recover/email`)
          .send({ email, code, newPin: '123456', newPinConfirm: '123456' })
          .expect(400);
        await http
          .post(`/auth/${audience}/recover/email`)
          .send({ email, code, newPin: '715204', newPinConfirm: '715205' })
          .expect(400);
      });
    });

    describe('ajout d’un email (connecté)', () => {
      it('exige d’être connecté', async () => {
        await client(app)
          .post(`/auth/${audience}/email/add`)
          .send({ email: uniqueEmail() })
          .expect(401);
        await client(app)
          .post(`/auth/${audience}/email/confirm`)
          .send({ email: uniqueEmail(), code: '123456' })
          .expect(401);
      });

      it('refuse une adresse déjà prise (409) ou un compte qui en a déjà une (409)', async () => {
        const taken = await signUpByEmail(audience);
        const other = await signUpByEmail(audience);
        await other.http
          .post(`/auth/${audience}/email/add`)
          .set(bearer(other.token))
          .send({ email: uniqueEmail() })
          .expect(409);
        const phoneUser = await client(app)
          .post('/auth/customer/register')
          .send(customerBody())
          .expect(201);
        const http = client(app);
        // jeton client sur l'espace personnel : refusé ; on ajoute donc via l'espace client
        await http
          .post('/auth/customer/email/add')
          .set(bearer(phoneUser.body.accessToken))
          .send({ email: taken.email })
          .expect(409);
      });

      it('un mauvais code ne rattache rien', async () => {
        const phoneUser = await client(app)
          .post('/auth/customer/register')
          .send(customerBody())
          .expect(201);
        const email = uniqueEmail();
        const http = client(app);
        await http
          .post('/auth/customer/email/add')
          .set(bearer(phoneUser.body.accessToken))
          .send({ email })
          .expect(202);
        const code = mails.lastCodeTo(email)!;
        const wrong = code === '000000' ? '111111' : '000000';
        await http
          .post('/auth/customer/email/confirm')
          .set(bearer(phoneUser.body.accessToken))
          .send({ email, code: wrong })
          .expect(400);
        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: phoneUser.body.user.id } })).email,
        ).toBeNull();
      });

      it('le code d’un autre utilisateur ne rattache pas l’adresse', async () => {
        const a = await client(app)
          .post('/auth/customer/register')
          .send(customerBody())
          .expect(201);
        const b = await client(app)
          .post('/auth/customer/register')
          .send(customerBody())
          .expect(201);
        const email = uniqueEmail();
        const http = client(app);
        await http
          .post('/auth/customer/email/add')
          .set(bearer(a.body.accessToken))
          .send({ email })
          .expect(202);
        await http
          .post('/auth/customer/email/confirm')
          .set(bearer(b.body.accessToken))
          .send({ email, code: mails.lastCodeTo(email) })
          .expect(400);
        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: a.body.user.id } })).email,
        ).toBeNull();
      });
    });

    describe('Google', () => {
      it('crée un compte avec un email vérifié, puis reconnecte le même', async () => {
        const email = uniqueEmail();
        const token = google.register(email, { name: 'Awa Google' });
        const http = client(app);
        const first = await http
          .post(`/auth/${audience}/google`)
          .send({ idToken: token })
          .expect(200);
        expect(first.body.isNew).toBe(true);
        expect(first.body.user).toMatchObject({
          email,
          emailVerified: true,
          name: 'Awa Google',
          phone: null,
        });
        expect(cookieValue(first, cookieOf(audience))).toBeDefined();

        const second = await http
          .post(`/auth/${audience}/google`)
          .send({ idToken: token })
          .expect(200);
        expect(second.body.isNew).toBe(false);
        expect(second.body.user.id).toBe(first.body.user.id);
        const me = await http
          .get(`/auth/${audience}/me`)
          .set(bearer(second.body.accessToken))
          .expect(200);
        expect(me.body.user.email).toBe(email);
        expect(await prisma.credential.count({ where: { userId: first.body.user.id } })).toBe(0);
      });

      it('rattache Google à un compte email existant (email vérifié des deux côtés)', async () => {
        const existing = await signUpByEmail(audience);
        const token = google.register(existing.email);
        const res = await client(app)
          .post(`/auth/${audience}/google`)
          .send({ idToken: token })
          .expect(200);
        expect(res.body.isNew).toBe(false);
        expect(res.body.user.id).toBe(existing.userId);
        // Le mot de passe d'origine fonctionne toujours.
        await client(app)
          .post(`/auth/${audience}/login-email`)
          .send({ email: existing.email, password: PASSWORD })
          .expect(200);
        expect(await prisma.user.count({ where: { email: existing.email } })).toBe(1);
      });

      it('refuse un email non vérifié par Google, ou absent : aucun compte créé ni rattaché', async () => {
        const existing = await signUpByEmail(audience);
        const unverified = google.register(existing.email, { emailVerified: false });
        await client(app)
          .post(`/auth/${audience}/google`)
          .send({ idToken: unverified })
          .expect(401);
        const noEmail = google.register(null);
        const res = await client(app)
          .post(`/auth/${audience}/google`)
          .send({ idToken: noEmail })
          .expect(401);
        expect(res.body.message).toBe('google.emailNotVerified');
        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: existing.userId } })).googleSub,
        ).toBeNull();
      });

      it('refuse un jeton inconnu ou mal formé', async () => {
        await client(app)
          .post(`/auth/${audience}/google`)
          .send({ idToken: 'x'.repeat(60) })
          .expect(401);
        await client(app).post(`/auth/${audience}/google`).send({ idToken: 'court' }).expect(400);
        await client(app).post(`/auth/${audience}/google`).send({}).expect(400);
      });

      it('un compte Google peut ensuite fixer un mot de passe via « mot de passe oublié »', async () => {
        const email = uniqueEmail();
        const http = client(app);
        await http
          .post(`/auth/${audience}/google`)
          .send({ idToken: google.register(email) })
          .expect(200);
        await http
          .post(`/auth/${audience}/login-email`)
          .send({ email, password: PASSWORD })
          .expect(401);
        await http.post(`/auth/${audience}/email/forgot`).send({ email }).expect(202);
        await http
          .post(`/auth/${audience}/recover/email`)
          .send({ email, code: mails.lastCodeTo(email), newPassword: NEW_PASSWORD })
          .expect(200);
        await http
          .post(`/auth/${audience}/login-email`)
          .send({ email, password: NEW_PASSWORD })
          .expect(200);
      });

      it('ralentit les jetons invalides répétés depuis une même IP', async () => {
        const http = client(app);
        for (let i = 0; i < 30; i++) {
          await http
            .post(`/auth/${audience}/google`)
            .send({ idToken: `invalide-${i}-${'x'.repeat(40)}` })
            .expect(401);
        }
        await http
          .post(`/auth/${audience}/google`)
          .send({ idToken: google.register(uniqueEmail()) })
          .expect(429);
      });
    });

    describe('ajout d’un numéro (compte email ou Google)', () => {
      it('rattache un numéro non vérifié', async () => {
        const { http, token } = await signUpByEmail(audience);
        const phone = uniquePhone();
        const res = await http
          .post(`/auth/${audience}/phone`)
          .set(bearer(token))
          .send({ phone })
          .expect(200);
        expect(res.body.user).toMatchObject({ phone, phoneVerified: false });
      });

      it('normalise le numéro saisi', async () => {
        const { http, token } = await signUpByEmail(audience);
        const phone = uniquePhone();
        const spaced = phone.slice(4).replace(/(\d)(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5');
        const res = await http
          .post(`/auth/${audience}/phone`)
          .set(bearer(token))
          .send({ phone: spaced })
          .expect(200);
        expect(res.body.user.phone).toBe(phone);
      });

      it('refuse un numéro déjà pris, un second numéro, un numéro invalide et l’absence de connexion', async () => {
        const taken = await client(app)
          .post('/auth/customer/register')
          .send(customerBody())
          .expect(201);
        const { http, token } = await signUpByEmail(audience);
        await http
          .post(`/auth/${audience}/phone`)
          .set(bearer(token))
          .send({ phone: taken.body.user.phone })
          .expect(409);
        await http
          .post(`/auth/${audience}/phone`)
          .set(bearer(token))
          .send({ phone: '123' })
          .expect(400);
        await http.post(`/auth/${audience}/phone`).send({ phone: uniquePhone() }).expect(401);

        await http
          .post(`/auth/${audience}/phone`)
          .set(bearer(token))
          .send({ phone: uniquePhone() })
          .expect(200);
        const again = await http
          .post(`/auth/${audience}/phone`)
          .set(bearer(token))
          .send({ phone: uniquePhone() })
          .expect(409);
        expect(again.body.message).toBe('auth.phoneAlreadySet');
      });
    });
  });

  describe('transversal', () => {
    it('un même compte email se connecte dans les deux espaces', async () => {
      const { email } = await signUpByEmail('customer');
      const http = client(app);
      const staff = await http
        .post('/auth/staff/login-email')
        .send({ email, password: PASSWORD })
        .expect(200);
      const me = await http.get('/auth/staff/me').set(bearer(staff.body.accessToken)).expect(200);
      expect(me.body.memberships).toEqual([]);
    });

    it('une récupération en attente tombe quand le titulaire se connecte par email ou Google', async () => {
      const email = uniqueEmail();
      const { userId } = await signUpByEmail('staff', email);
      const pending = () =>
        prisma.recoveryRequest.create({
          data: { userId, newPinHash: 'x', availableAt: new Date(Date.now() + 3_600_000) },
        });
      await pending();
      const login = await client(app)
        .post('/auth/staff/login-email')
        .send({ email, password: PASSWORD })
        .expect(200);
      expect(login.body.recoveryCancelled).toBe(true);

      await pending();
      const viaGoogle = await client(app)
        .post('/auth/staff/google')
        .send({ idToken: google.register(email) })
        .expect(200);
      expect(viaGoogle.body.recoveryCancelled).toBe(true);
      expect(await prisma.recoveryRequest.count({ where: { userId, status: 'PENDING' } })).toBe(0);
    });

    it('journalise sans jamais écrire de secret', async () => {
      const email = uniqueEmail();
      const { userId } = await signUpByEmail('customer', email);
      await client(app)
        .post('/auth/customer/login-email')
        .send({ email, password: 'Mauvais-mdp-1' })
        .expect(401);
      const logs = await prisma.auditLog.findMany({ where: { userId } });
      expect(logs.map((l) => l.action)).toEqual(
        expect.arrayContaining(['auth.register.email', 'auth.login.failed']),
      );
      const dump = JSON.stringify(logs);
      expect(dump).not.toContain(PASSWORD);
      expect(dump).not.toContain('Mauvais-mdp-1');
    });
  });
});
