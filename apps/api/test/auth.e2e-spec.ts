import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma.service.js';
import {
  type Audience,
  PIN,
  client,
  cookieValue,
  customerBody,
  ownerBody,
  setCookieLine,
  uniquePhone,
} from './auth-helpers.js';
import { createTestApp } from './helpers.js';

const bodyFor = (audience: Audience, over: Record<string, unknown> = {}) =>
  audience === 'staff' ? ownerBody(over) : customerBody(over);
const cookieNameFor = (audience: Audience) => `resto_${audience}_rt`;

describe('Authentification (vraie base resto_test)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Inscrit un compte et renvoie ce qu'il faut pour la suite. */
  async function signUp(audience: Audience, over: Record<string, unknown> = {}) {
    const http = client(app);
    const body = bodyFor(audience, over);
    const res = await http.post(`/auth/${audience}/register`).send(body).expect(201);
    return {
      http,
      body,
      phone: body.phone as string,
      res,
      accessToken: res.body.accessToken as string,
      refresh: cookieValue(res, cookieNameFor(audience)) as string,
      recoveryCode: res.body.recoveryCode as string,
    };
  }

  describe.each<Audience>(['staff', 'customer'])('espace %s', (audience) => {
    describe('inscription', () => {
      it('crée le compte, ouvre une session et remet le code de secours', async () => {
        const { res, phone, body } = await signUp(audience);
        expect(res.body.accessToken).toEqual(expect.any(String));
        expect(res.body.expiresIn).toBe(900);
        expect(res.body.recoveryCode).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/);
        expect(res.body.user).toMatchObject({ phone, phoneVerified: false, restricted: false });
        expect(res.body).not.toHaveProperty('refreshToken');

        const user = await prisma.user.findUniqueOrThrow({
          where: { phone },
          include: {
            credentials: true,
            recoveryProfile: { include: { answers: true } },
            recoveryCodes: true,
          },
        });
        expect(user.credentials).toHaveLength(1);
        expect(user.credentials[0]?.hash.startsWith('$argon2id$')).toBe(true);
        expect(user.recoveryProfile?.answers).toHaveLength(audience === 'staff' ? 2 : 1);
        expect(user.recoveryCodes).toHaveLength(1);
        expect(body.pin).toBe(PIN);
      });

      it('ne stocke aucun secret en clair', async () => {
        const { phone, recoveryCode } = await signUp(audience, {
          recoveryAnswers: bodyFor(audience).recoveryAnswers.map((a: { question: string }) => ({
            ...a,
            answer: 'Réponse-Très-Particulière',
          })),
        });
        const user = await prisma.user.findUniqueOrThrow({ where: { phone } });
        const dump = JSON.stringify({
          user,
          credentials: await prisma.credential.findMany({ where: { userId: user.id } }),
          profile: await prisma.recoveryProfile.findMany({ where: { userId: user.id } }),
          answers: await prisma.recoveryAnswer.findMany({ where: { userId: user.id } }),
          codes: await prisma.recoveryCode.findMany({ where: { userId: user.id } }),
        });
        for (const secret of [
          PIN,
          '1980-11-12',
          '1990-03-05',
          'reponse',
          'Réponse',
          recoveryCode,
        ]) {
          expect(dump).not.toContain(secret);
        }
      });

      it('pose un cookie httpOnly limité à l’espace, SameSite=Lax', async () => {
        const { res } = await signUp(audience);
        const line = setCookieLine(res, cookieNameFor(audience));
        expect(line).toMatch(/HttpOnly/i);
        expect(line).toMatch(/SameSite=Lax/i);
        expect(line).toContain(`Path=/auth/${audience}`);
        expect(line).toMatch(/Max-Age=\d+/);
      });

      it('refuse un numéro déjà inscrit (409)', async () => {
        const { body } = await signUp(audience);
        const res = await client(app).post(`/auth/${audience}/register`).send(body).expect(409);
        expect(res.body.message).toBe('auth.phoneTaken');
      });

      it('refuse un numéro déjà pris dans l’autre espace : une seule identité par numéro', async () => {
        const other: Audience = audience === 'staff' ? 'customer' : 'staff';
        const { phone } = await signUp(other);
        await client(app)
          .post(`/auth/${audience}/register`)
          .send(bodyFor(audience, { phone }))
          .expect(409);
      });

      it('accepte les formats usuels du numéro et le normalise', async () => {
        const digits = uniquePhone().slice(4);
        const spaced = `${digits.slice(0, 1)} ${digits.slice(1, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 7)} ${digits.slice(7)}`;
        const res = await client(app)
          .post(`/auth/${audience}/register`)
          .send(bodyFor(audience, { phone: spaced }))
          .expect(201);
        expect(res.body.user.phone).toBe(`+237${digits}`);
      });

      it.each([
        ['PIN trop facile', { pin: '123456', pinConfirm: '123456' }, 'pin'],
        ['confirmation différente', { pinConfirm: '483921' }, 'pinConfirm'],
        ['PIN de 5 chiffres', { pin: '48392', pinConfirm: '48392' }, 'pin'],
        ['téléphone invalide', { phone: '12345' }, 'phone'],
        ['date impossible', { birthDate: { day: 31, month: 2, year: 1990 } }, 'birthDate'],
        ['aucune réponse secrète', { recoveryAnswers: [] }, 'recoveryAnswers'],
      ])('400 avec le champ fautif : %s', async (_label, over, field) => {
        const res = await client(app)
          .post(`/auth/${audience}/register`)
          .send(bodyFor(audience, over))
          .expect(400);
        expect(res.body.error).toBe('ValidationError');
        expect(res.body.issues.map((i: { path: string }) => i.path.split('.')[0])).toContain(field);
      });

      it('400 sur un corps vide', async () => {
        await client(app).post(`/auth/${audience}/register`).send().expect(400);
      });

      it('ne crée rien quand la validation échoue', async () => {
        const phone = uniquePhone();
        await client(app)
          .post(`/auth/${audience}/register`)
          .send(bodyFor(audience, { phone, pin: '111111', pinConfirm: '111111' }))
          .expect(400);
        expect(await prisma.user.findUnique({ where: { phone } })).toBeNull();
      });
    });

    describe('connexion', () => {
      it('connecte avec le bon PIN', async () => {
        const { phone } = await signUp(audience);
        const res = await client(app)
          .post(`/auth/${audience}/login`)
          .send({ phone, pin: PIN })
          .expect(200);
        expect(res.body.accessToken).toEqual(expect.any(String));
        expect(res.body.mustChangePin).toBe(false);
        expect(setCookieLine(res, cookieNameFor(audience))).toBeDefined();
      });

      it('accepte le numéro sous une autre forme', async () => {
        const { phone } = await signUp(audience);
        await client(app)
          .post(`/auth/${audience}/login`)
          .send({ phone: phone.slice(4), pin: PIN })
          .expect(200);
      });

      it('401 identique pour un mauvais PIN et pour un numéro inconnu', async () => {
        const { phone } = await signUp(audience);
        const wrong = await client(app)
          .post(`/auth/${audience}/login`)
          .send({ phone, pin: '000001' })
          .expect(401);
        const unknown = await client(app)
          .post(`/auth/${audience}/login`)
          .send({ phone: uniquePhone(), pin: PIN })
          .expect(401);
        expect(wrong.body).toEqual(unknown.body);
        expect(wrong.body.message).toBe('auth.invalidCredentials');
        expect(setCookieLine(wrong, cookieNameFor(audience))).toBeUndefined();
      });

      it('400 sur un PIN mal formé', async () => {
        const { phone } = await signUp(audience);
        await client(app).post(`/auth/${audience}/login`).send({ phone, pin: '12ab' }).expect(400);
      });

      it('signale un PIN temporaire à changer', async () => {
        const { phone } = await signUp(audience);
        await prisma.credential.updateMany({
          where: { user: { phone } },
          data: { mustChange: true },
        });
        const res = await client(app)
          .post(`/auth/${audience}/login`)
          .send({ phone, pin: PIN })
          .expect(200);
        expect(res.body.mustChangePin).toBe(true);
      });

      it('ralentit après 5 échecs : 429 + Retry-After, même avec le bon PIN', async () => {
        const { phone } = await signUp(audience);
        const http = client(app);
        for (let i = 0; i < 5; i++) {
          await http.post(`/auth/${audience}/login`).send({ phone, pin: '000001' }).expect(401);
        }
        const blocked = await http
          .post(`/auth/${audience}/login`)
          .send({ phone, pin: PIN })
          .expect(429);
        expect(blocked.body.message).toBe('auth.tooManyAttempts');
        expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
        expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(30);
        expect(blocked.body.retryAfter).toBe(Number(blocked.headers['retry-after']));
      });

      it('le blocage vise le compte : un autre numéro n’est pas touché', async () => {
        const victim = await signUp(audience);
        const other = await signUp(audience);
        const attacker = client(app);
        for (let i = 0; i < 5; i++) {
          await attacker
            .post(`/auth/${audience}/login`)
            .send({ phone: victim.phone, pin: '000001' })
            .expect(401);
        }
        await attacker
          .post(`/auth/${audience}/login`)
          .send({ phone: victim.phone, pin: PIN })
          .expect(429);
        // La victime reste bloquée depuis toute IP : c'est le ralentissement du compte, pas de l'IP.
        await client(app)
          .post(`/auth/${audience}/login`)
          .send({ phone: victim.phone, pin: PIN })
          .expect(429);
        await attacker
          .post(`/auth/${audience}/login`)
          .send({ phone: other.phone, pin: PIN })
          .expect(200);
      });

      it('un succès remet à zéro les échecs du compte', async () => {
        const { phone } = await signUp(audience);
        const http = client(app);
        for (let i = 0; i < 4; i++) {
          await http.post(`/auth/${audience}/login`).send({ phone, pin: '000001' }).expect(401);
        }
        await http.post(`/auth/${audience}/login`).send({ phone, pin: PIN }).expect(200);
        for (let i = 0; i < 4; i++) {
          await http.post(`/auth/${audience}/login`).send({ phone, pin: '000001' }).expect(401);
        }
        await http.post(`/auth/${audience}/login`).send({ phone, pin: PIN }).expect(200);
      });

      it('limite aussi les inscriptions depuis une même IP', async () => {
        const http = client(app);
        for (let i = 0; i < 10; i++) {
          await http.post(`/auth/${audience}/register`).send(bodyFor(audience)).expect(201);
        }
        const res = await http
          .post(`/auth/${audience}/register`)
          .send(bodyFor(audience))
          .expect(429);
        expect(res.headers['retry-after']).toBeDefined();
      });
    });

    describe('session, rafraîchissement, déconnexion', () => {
      it('GET /me renvoie le profil sans aucune empreinte', async () => {
        const { http, accessToken, phone } = await signUp(audience);
        const res = await http
          .get(`/auth/${audience}/me`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);
        expect(res.body.user.phone).toBe(phone);
        expect(res.body.mustChangePin).toBe(false);
        expect(JSON.stringify(res.body)).not.toMatch(/hash|argon|recovery/i);
      });

      it('GET /me exige un jeton valide', async () => {
        const { http, accessToken } = await signUp(audience);
        await http.get(`/auth/${audience}/me`).expect(401);
        await http
          .get(`/auth/${audience}/me`)
          .set('Authorization', 'Bearer n-importe-quoi')
          .expect(401);
        await http.get(`/auth/${audience}/me`).set('Authorization', accessToken).expect(401);
      });

      it('un jeton de l’autre espace est refusé', async () => {
        const other: Audience = audience === 'staff' ? 'customer' : 'staff';
        const { http, phone } = await signUp(audience);
        const login = await http.post(`/auth/${other}/login`).send({ phone, pin: PIN }).expect(200);
        // Même utilisateur, mais le jeton « other » n'ouvre pas cet espace.
        await http
          .get(`/auth/${audience}/me`)
          .set('Authorization', `Bearer ${login.body.accessToken}`)
          .expect(401);
      });

      it('refresh : renouvelle les jetons et fait tourner le cookie', async () => {
        const { http, refresh } = await signUp(audience);
        const res = await http
          .post(`/auth/${audience}/refresh`)
          .set('Cookie', `${cookieNameFor(audience)}=${refresh}`)
          .expect(200);
        expect(res.body.accessToken).toEqual(expect.any(String));
        const next = cookieValue(res, cookieNameFor(audience));
        expect(next).toBeDefined();
        expect(next).not.toBe(refresh);
        await http
          .post(`/auth/${audience}/refresh`)
          .set('Cookie', `${cookieNameFor(audience)}=${next}`)
          .expect(200);
      });

      it('refresh sans cookie ou avec un cookie inconnu : 401', async () => {
        const http = client(app);
        await http.post(`/auth/${audience}/refresh`).expect(401);
        await http
          .post(`/auth/${audience}/refresh`)
          .set('Cookie', `${cookieNameFor(audience)}=inconnu`)
          .expect(401);
      });

      it('le refresh token d’un espace ne fonctionne pas dans l’autre', async () => {
        const other: Audience = audience === 'staff' ? 'customer' : 'staff';
        const { http, refresh } = await signUp(audience);
        await http
          .post(`/auth/${other}/refresh`)
          .set('Cookie', `${cookieNameFor(other)}=${refresh}`)
          .expect(401);
      });

      it('un jeton déjà échangé, rejoué plus tard, révoque toute la session', async () => {
        const { http, refresh, phone } = await signUp(audience);
        const cookie = (v: string) => `${cookieNameFor(audience)}=${v}`;
        const rotated = await http
          .post(`/auth/${audience}/refresh`)
          .set('Cookie', cookie(refresh))
          .expect(200);
        const next = cookieValue(rotated, cookieNameFor(audience)) as string;

        // On vieillit l'usage du premier jeton au-delà de la tolérance de 10 s.
        await prisma.refreshToken.updateMany({
          where: { user: { phone }, usedAt: { not: null } },
          data: { usedAt: new Date(Date.now() - 60_000) },
        });
        await http.post(`/auth/${audience}/refresh`).set('Cookie', cookie(refresh)).expect(401);
        // Le jeton le plus récent est lui aussi invalidé : le voleur comme la victime se reconnectent.
        await http.post(`/auth/${audience}/refresh`).set('Cookie', cookie(next)).expect(401);
      });

      it('deux onglets qui rafraîchissent presque ensemble ne coupent pas la session', async () => {
        const { http, refresh } = await signUp(audience);
        const cookie = `${cookieNameFor(audience)}=${refresh}`;
        const first = await http
          .post(`/auth/${audience}/refresh`)
          .set('Cookie', cookie)
          .expect(200);
        await http.post(`/auth/${audience}/refresh`).set('Cookie', cookie).expect(401);
        const next = cookieValue(first, cookieNameFor(audience));
        await http
          .post(`/auth/${audience}/refresh`)
          .set('Cookie', `${cookieNameFor(audience)}=${next}`)
          .expect(200);
      });

      it('refuse un refresh token expiré', async () => {
        const { http, refresh, phone } = await signUp(audience);
        await prisma.refreshToken.updateMany({
          where: { user: { phone } },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
        await http
          .post(`/auth/${audience}/refresh`)
          .set('Cookie', `${cookieNameFor(audience)}=${refresh}`)
          .expect(401);
      });

      it('logout : 204, cookie effacé, refresh impossible ensuite', async () => {
        const { http, refresh } = await signUp(audience);
        const cookie = `${cookieNameFor(audience)}=${refresh}`;
        const res = await http.post(`/auth/${audience}/logout`).set('Cookie', cookie).expect(204);
        expect(setCookieLine(res, cookieNameFor(audience))).toMatch(/Expires=Thu, 01 Jan 1970/);
        await http.post(`/auth/${audience}/refresh`).set('Cookie', cookie).expect(401);
      });

      it('logout est silencieux sans session', async () => {
        await client(app).post(`/auth/${audience}/logout`).expect(204);
      });
    });

    describe('client natif (mobile)', () => {
      it('renvoie le refresh token dans le corps, sans cookie, et le reçoit dans le corps', async () => {
        const http = client(app, { native: true });
        const reg = await http
          .post(`/auth/${audience}/register`)
          .send(bodyFor(audience))
          .expect(201);
        expect(reg.body.refreshToken).toEqual(expect.any(String));
        expect(setCookieLine(reg, cookieNameFor(audience))).toBeUndefined();

        const next = await http
          .post(`/auth/${audience}/refresh`)
          .send({ refreshToken: reg.body.refreshToken })
          .expect(200);
        expect(next.body.refreshToken).not.toBe(reg.body.refreshToken);

        await http
          .post(`/auth/${audience}/logout`)
          .send({ refreshToken: next.body.refreshToken })
          .expect(204);
        await http
          .post(`/auth/${audience}/refresh`)
          .send({ refreshToken: next.body.refreshToken })
          .expect(401);
      });

      it('un client web ne peut pas fournir le jeton dans le corps', async () => {
        const { http, refresh } = await signUp(audience);
        await http.post(`/auth/${audience}/refresh`).send({ refreshToken: refresh }).expect(401);
      });
    });

    describe('changement de PIN', () => {
      const NEW_PIN = '715204';

      it('change le PIN, déconnecte les autres sessions et en ouvre une nouvelle', async () => {
        const { http, accessToken, refresh, phone } = await signUp(audience);
        const res = await http
          .post(`/auth/${audience}/pin`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ currentPin: PIN, newPin: NEW_PIN, newPinConfirm: NEW_PIN })
          .expect(200);
        expect(res.body.accessToken).toEqual(expect.any(String));

        await http
          .post(`/auth/${audience}/refresh`)
          .set('Cookie', `${cookieNameFor(audience)}=${refresh}`)
          .expect(401);
        await http.post(`/auth/${audience}/login`).send({ phone, pin: PIN }).expect(401);
        await http.post(`/auth/${audience}/login`).send({ phone, pin: NEW_PIN }).expect(200);
      });

      it('lève l’obligation de changer un PIN temporaire', async () => {
        const { http, accessToken, phone } = await signUp(audience);
        await prisma.credential.updateMany({
          where: { user: { phone } },
          data: { mustChange: true },
        });
        await http
          .post(`/auth/${audience}/pin`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ currentPin: PIN, newPin: NEW_PIN, newPinConfirm: NEW_PIN })
          .expect(200);
        const login = await http
          .post(`/auth/${audience}/login`)
          .send({ phone, pin: NEW_PIN })
          .expect(200);
        expect(login.body.mustChangePin).toBe(false);
      });

      it('refuse un mauvais PIN actuel (401) et ne change rien', async () => {
        const { http, accessToken, phone } = await signUp(audience);
        await http
          .post(`/auth/${audience}/pin`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ currentPin: '000001', newPin: NEW_PIN, newPinConfirm: NEW_PIN })
          .expect(401);
        await http.post(`/auth/${audience}/login`).send({ phone, pin: PIN }).expect(200);
      });

      it.each([
        ['nouveau PIN faible', { currentPin: PIN, newPin: '123456', newPinConfirm: '123456' }],
        ['confirmation différente', { currentPin: PIN, newPin: NEW_PIN, newPinConfirm: '715205' }],
        ['même PIN', { currentPin: PIN, newPin: PIN, newPinConfirm: PIN }],
      ])('400 : %s', async (_label, payload) => {
        const { http, accessToken } = await signUp(audience);
        await http
          .post(`/auth/${audience}/pin`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send(payload)
          .expect(400);
      });

      it('exige d’être connecté', async () => {
        await client(app)
          .post(`/auth/${audience}/pin`)
          .send({ currentPin: PIN, newPin: NEW_PIN, newPinConfirm: NEW_PIN })
          .expect(401);
      });

      it('ralentit les essais répétés de l’ancien PIN', async () => {
        const { http, accessToken } = await signUp(audience);
        const attempt = () =>
          http
            .post(`/auth/${audience}/pin`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ currentPin: '000001', newPin: NEW_PIN, newPinConfirm: NEW_PIN });
        for (let i = 0; i < 5; i++) await attempt().expect(401);
        await attempt().expect(429);
      });
    });
  });

  describe('une seule identité pour les deux espaces', () => {
    it('un client peut se connecter au back-office avec le même numéro et voir ses rôles', async () => {
      const { phone } = await signUp('customer');
      const login = await client(app)
        .post('/auth/staff/login')
        .send({ phone, pin: PIN })
        .expect(200);
      const me = await client(app)
        .get('/auth/staff/me')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);
      expect(me.body.memberships).toEqual([]);
    });

    it('/me du personnel liste uniquement les rôles actifs', async () => {
      const { http, accessToken, phone } = await signUp('staff');
      const user = await prisma.user.findUniqueOrThrow({ where: { phone } });
      const [r1, r2, r3] = await Promise.all(
        ['a', 'b', 'c'].map((s) =>
          prisma.restaurant.create({ data: { slug: `${s}-${user.id}`, name: s, city: 'Douala' } }),
        ),
      );
      await prisma.membership.createMany({
        data: [
          { userId: user.id, restaurantId: r1!.id, role: 'OWNER', status: 'ACTIVE' },
          { userId: user.id, restaurantId: r2!.id, role: 'WAITER', status: 'PENDING' },
          { userId: user.id, restaurantId: r3!.id, role: 'CASHIER', status: 'REVOKED' },
        ],
      });
      const me = await http
        .get('/auth/staff/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(me.body.memberships).toEqual([{ restaurantId: r1!.id, role: 'OWNER' }]);
    });

    it('/me du client n’expose pas de rôles', async () => {
      const { http, accessToken } = await signUp('customer');
      const me = await http
        .get('/auth/customer/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(me.body).not.toHaveProperty('memberships');
    });
  });

  describe('transport', () => {
    it('répond 404 pour un espace inconnu', async () => {
      await client(app)
        .post('/auth/admin/login')
        .send({ phone: uniquePhone(), pin: PIN })
        .expect(404);
      await client(app).get('/auth/admin/me').expect(404);
    });

    it('CORS : accepte les sites configurés avec les cookies, refuse les autres', async () => {
      const ok = await request(app.getHttpServer())
        .options('/auth/staff/login')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);
      expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(ok.headers['access-control-allow-credentials']).toBe('true');

      const ko = await request(app.getHttpServer())
        .options('/auth/staff/login')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'POST');
      expect(ko.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('journalise inscription, connexion et échec', async () => {
      const { phone } = await signUp('customer');
      const http = client(app);
      await http.post('/auth/customer/login').send({ phone, pin: PIN }).expect(200);
      await http.post('/auth/customer/login').send({ phone, pin: '000001' }).expect(401);
      const user = await prisma.user.findUniqueOrThrow({ where: { phone } });
      const logs = await prisma.auditLog.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(logs.map((l) => l.action)).toEqual([
        'auth.register',
        'auth.login',
        'auth.login.failed',
      ]);
      expect(JSON.stringify(logs)).not.toContain(PIN);
    });
  });
});
