import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma.service.js';
import { PIN, client, cookieValue, customerBody, ownerBody, uniquePhone } from './auth-helpers.js';
import { createTestApp } from './helpers.js';

const NEW_PIN = '715204';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Récupération de compte (vraie base resto_test)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function newCustomer(over: Record<string, unknown> = {}) {
    const body = customerBody(over);
    const res = await client(app).post('/auth/customer/register').send(body).expect(201);
    return {
      phone: body.phone as string,
      userId: res.body.user.id as string,
      token: res.body.accessToken as string,
      refresh: cookieValue(res, 'resto_customer_rt') as string,
      recoveryCode: res.body.recoveryCode as string,
    };
  }

  async function newOwner() {
    const body = ownerBody();
    const http = client(app);
    const res = await http.post('/auth/staff/register').send(body).expect(201);
    const token = res.body.accessToken as string;
    const restaurant = await http
      .post('/restaurants')
      .set(bearer(token))
      .send({ name: 'Chez Récup', city: 'Douala' })
      .expect(201);
    return {
      http,
      phone: body.phone as string,
      userId: res.body.user.id as string,
      token,
      recoveryCode: res.body.recoveryCode as string,
      restaurantId: restaurant.body.id as string,
    };
  }

  const ownerAnswers = [
    { question: 'BIRTH_CITY', answer: 'bafoussam' },
    { question: 'FAVORITE_SPORT', answer: 'FOOTBALL' },
  ];
  const ownerBirth = { day: 12, month: 11, year: 1980 };
  const customerBirth = { day: 5, month: 3, year: 1990 };

  describe('par code de secours', () => {
    it.each(['customer', 'staff'] as const)(
      'espace %s : nouveau PIN, session neuve, ancien code mort',
      async (audience) => {
        const account = audience === 'staff' ? await newOwner() : await newCustomer();
        const http = client(app);
        const res = await http
          .post(`/auth/${audience}/recover/code`)
          .send({
            phone: account.phone,
            recoveryCode: account.recoveryCode.toLowerCase().replaceAll('-', ' '),
            newPin: NEW_PIN,
            newPinConfirm: NEW_PIN,
          })
          .expect(200);
        expect(res.body.accessToken).toEqual(expect.any(String));
        expect(res.body.recoveryCode).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/);
        expect(res.body.recoveryCode).not.toBe(account.recoveryCode);

        await http
          .post(`/auth/${audience}/login`)
          .send({ phone: account.phone, pin: PIN })
          .expect(401);
        await http
          .post(`/auth/${audience}/login`)
          .send({ phone: account.phone, pin: NEW_PIN })
          .expect(200);

        // L'ancien code ne sert plus ; le nouveau fonctionne.
        await client(app)
          .post(`/auth/${audience}/recover/code`)
          .send({
            phone: account.phone,
            recoveryCode: account.recoveryCode,
            newPin: '246813',
            newPinConfirm: '246813',
          })
          .expect(401);
        await client(app)
          .post(`/auth/${audience}/recover/code`)
          .send({
            phone: account.phone,
            recoveryCode: res.body.recoveryCode,
            newPin: '246813',
            newPinConfirm: '246813',
          })
          .expect(200);
      },
    );

    it('coupe toutes les sessions existantes', async () => {
      const c = await newCustomer();
      await client(app)
        .post('/auth/customer/recover/code')
        .send({
          phone: c.phone,
          recoveryCode: c.recoveryCode,
          newPin: NEW_PIN,
          newPinConfirm: NEW_PIN,
        })
        .expect(200);
      await client(app)
        .post('/auth/customer/refresh')
        .set('Cookie', `resto_customer_rt=${c.refresh}`)
        .expect(401);
    });

    it('échoue de la même façon pour un faux code, un code mal formé et un numéro inconnu', async () => {
      const c = await newCustomer();
      const attempt = (body: object) => client(app).post('/auth/customer/recover/code').send(body);
      const pins = { newPin: NEW_PIN, newPinConfirm: NEW_PIN };
      const wrong = await attempt({
        phone: c.phone,
        recoveryCode: 'ZZZZ-ZZZZ-ZZZZ',
        ...pins,
      }).expect(401);
      const malformed = await attempt({
        phone: c.phone,
        recoveryCode: 'OOOO-0000-1111',
        ...pins,
      }).expect(401);
      const unknown = await attempt({
        phone: uniquePhone(),
        recoveryCode: c.recoveryCode,
        ...pins,
      }).expect(401);
      expect(wrong.body).toEqual(malformed.body);
      expect(wrong.body).toEqual(unknown.body);
      expect(wrong.body.message).toBe('recovery.failed');
      await client(app).post('/auth/customer/login').send({ phone: c.phone, pin: PIN }).expect(200);
    });

    it('le code d’un autre compte ne fonctionne pas', async () => {
      const a = await newCustomer();
      const b = await newCustomer();
      await client(app)
        .post('/auth/customer/recover/code')
        .send({
          phone: a.phone,
          recoveryCode: b.recoveryCode,
          newPin: NEW_PIN,
          newPinConfirm: NEW_PIN,
        })
        .expect(401);
      await client(app).post('/auth/customer/login').send({ phone: a.phone, pin: PIN }).expect(200);
    });

    it('ralentit les essais : 4e tentative en 429 avec Retry-After, même avec le bon code', async () => {
      const c = await newCustomer();
      const http = client(app);
      const body = (code: string) => ({
        phone: c.phone,
        recoveryCode: code,
        newPin: NEW_PIN,
        newPinConfirm: NEW_PIN,
      });
      for (let i = 0; i < 3; i++) {
        await http.post('/auth/customer/recover/code').send(body('ZZZZ-ZZZZ-ZZZZ')).expect(401);
      }
      const blocked = await http
        .post('/auth/customer/recover/code')
        .send(body(c.recoveryCode))
        .expect(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    });

    it.each([
      ['PIN faible', { newPin: '123456', newPinConfirm: '123456' }],
      ['confirmation différente', { newPinConfirm: '715205' }],
      ['code trop court', { recoveryCode: 'ABCD' }],
    ])('400 : %s', async (_l, over) => {
      const c = await newCustomer();
      await client(app)
        .post('/auth/customer/recover/code')
        .send({
          phone: c.phone,
          recoveryCode: c.recoveryCode,
          newPin: NEW_PIN,
          newPinConfirm: NEW_PIN,
          ...over,
        })
        .expect(400);
    });

    it('annule une récupération par questions en attente', async () => {
      const o = await newOwner();
      await client(app)
        .post('/auth/staff/recover/questions')
        .send({
          phone: o.phone,
          birthDate: ownerBirth,
          recoveryAnswers: ownerAnswers,
          newPin: NEW_PIN,
          newPinConfirm: NEW_PIN,
        })
        .expect(202);
      await client(app)
        .post('/auth/staff/recover/code')
        .send({
          phone: o.phone,
          recoveryCode: o.recoveryCode,
          newPin: '246813',
          newPinConfirm: '246813',
        })
        .expect(200);
      expect(
        await prisma.recoveryRequest.count({ where: { userId: o.userId, status: 'PENDING' } }),
      ).toBe(0);
    });
  });

  describe('par questions — client', () => {
    const body = (phone: string, over: Record<string, unknown> = {}) => ({
      phone,
      birthDate: customerBirth,
      recoveryAnswers: [{ question: 'BIRTH_CITY', answer: ' douala ' }],
      newPin: NEW_PIN,
      newPinConfirm: NEW_PIN,
      ...over,
    });

    it('applique le PIN tout de suite, ouvre une session et restreint le compte 48 h', async () => {
      const c = await newCustomer();
      const res = await client(app)
        .post('/auth/customer/recover/questions')
        .send(body(c.phone))
        .expect(200);
      expect(res.body.status).toBe('completed');
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user.restricted).toBe(true);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
      const hours = (user.restrictedUntil!.getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(47.9);
      expect(hours).toBeLessThanOrEqual(48);

      await client(app).post('/auth/customer/login').send({ phone: c.phone, pin: PIN }).expect(401);
      const login = await client(app)
        .post('/auth/customer/login')
        .send({ phone: c.phone, pin: NEW_PIN })
        .expect(200);
      expect(login.body.user.restricted).toBe(true);
      await client(app)
        .post('/auth/customer/refresh')
        .set('Cookie', `resto_customer_rt=${c.refresh}`)
        .expect(401);
    });

    it.each([
      ['mauvaise date', { birthDate: { day: 6, month: 3, year: 1990 } }],
      ['mauvaise réponse', { recoveryAnswers: [{ question: 'BIRTH_CITY', answer: 'Yaoundé' }] }],
      [
        'question non configurée',
        { recoveryAnswers: [{ question: 'FAVORITE_ANIMAL', answer: 'lion' }] },
      ],
    ])('401 générique : %s', async (_l, over) => {
      const c = await newCustomer();
      const res = await client(app)
        .post('/auth/customer/recover/questions')
        .send(body(c.phone, over))
        .expect(401);
      expect(res.body.message).toBe('recovery.failed');
      await client(app).post('/auth/customer/login').send({ phone: c.phone, pin: PIN }).expect(200);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: c.userId } })).restrictedUntil,
      ).toBeNull();
    });

    it('même réponse pour un numéro inconnu', async () => {
      const c = await newCustomer();
      const known = await client(app)
        .post('/auth/customer/recover/questions')
        .send(body(c.phone, { birthDate: { day: 6, month: 3, year: 1990 } }))
        .expect(401);
      const unknown = await client(app)
        .post('/auth/customer/recover/questions')
        .send(body(uniquePhone()))
        .expect(401);
      expect(known.body).toEqual(unknown.body);
    });

    it('ralentit les essais : 4e tentative bloquée même avec les bonnes réponses', async () => {
      const c = await newCustomer();
      const http = client(app);
      const wrong = body(c.phone, { birthDate: { day: 6, month: 3, year: 1990 } });
      for (let i = 0; i < 3; i++)
        await http.post('/auth/customer/recover/questions').send(wrong).expect(401);
      await http.post('/auth/customer/recover/questions').send(body(c.phone)).expect(429);
      await client(app).post('/auth/customer/login').send({ phone: c.phone, pin: PIN }).expect(200);
    });

    it('partage le compteur avec la récupération par code (pas de double budget)', async () => {
      const c = await newCustomer();
      const http = client(app);
      for (let i = 0; i < 3; i++) {
        await http
          .post('/auth/customer/recover/code')
          .send({
            phone: c.phone,
            recoveryCode: 'ZZZZ-ZZZZ-ZZZZ',
            newPin: NEW_PIN,
            newPinConfirm: NEW_PIN,
          })
          .expect(401);
      }
      await http.post('/auth/customer/recover/questions').send(body(c.phone)).expect(429);
    });

    it('un compte sans profil de récupération (créé par un gérant) ne peut pas l’utiliser', async () => {
      const o = await newOwner();
      const phone = uniquePhone();
      await o.http
        .post(`/restaurants/${o.restaurantId}/team`)
        .set(bearer(o.token))
        .send({ name: 'Jean Nkoulou', phone, role: 'WAITER' })
        .expect(201);
      await client(app).post('/auth/staff/recover/questions').send(body(phone)).expect(401);
    });

    it('400 sur une saisie invalide', async () => {
      const c = await newCustomer();
      await client(app)
        .post('/auth/customer/recover/questions')
        .send(body(c.phone, { recoveryAnswers: [] }))
        .expect(400);
      await client(app)
        .post('/auth/customer/recover/questions')
        .send(body(c.phone, { birthDate: { day: 31, month: 2, year: 1990 } }))
        .expect(400);
    });
  });

  describe('par questions — propriétaire (différé)', () => {
    const body = (phone: string, over: Record<string, unknown> = {}) => ({
      phone,
      birthDate: ownerBirth,
      recoveryAnswers: ownerAnswers,
      newPin: NEW_PIN,
      newPinConfirm: NEW_PIN,
      ...over,
    });

    it('202 : rien n’est appliqué avant l’échéance de 48 h, l’ancien PIN reste valable', async () => {
      const o = await newOwner();
      const res = await client(app)
        .post('/auth/staff/recover/questions')
        .send(body(o.phone))
        .expect(202);
      expect(res.body.status).toBe('pending');
      expect(res.body).not.toHaveProperty('accessToken');
      const hours = (new Date(res.body.availableAt).getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(47.9);

      const request = await prisma.recoveryRequest.findFirstOrThrow({
        where: { userId: o.userId },
      });
      expect(request.newPinHash.startsWith('$argon2id$')).toBe(true);
      expect(request.newPinHash).not.toContain(NEW_PIN);

      // Le titulaire peut encore utiliser son compte avec l'ancien PIN... ce qui annule la demande.
      const login = await client(app)
        .post('/auth/staff/login')
        .send({ phone: o.phone, pin: PIN })
        .expect(200);
      expect(login.body.recoveryCancelled).toBe(true);
      expect(
        (await prisma.recoveryRequest.findUniqueOrThrow({ where: { id: request.id } })).cancelledBy,
      ).toBe('login');
    });

    it('une seule réponse ne suffit pas pour un propriétaire (401 générique, rien créé)', async () => {
      const o = await newOwner();
      await client(app)
        .post('/auth/staff/recover/questions')
        .send(body(o.phone, { recoveryAnswers: [ownerAnswers[0]] }))
        .expect(401);
      expect(await prisma.recoveryRequest.count({ where: { userId: o.userId } })).toBe(0);
    });

    it('depuis la vitrine, le même compte subit la même exigence', async () => {
      const o = await newOwner();
      await client(app)
        .post('/auth/customer/recover/questions')
        .send(body(o.phone, { recoveryAnswers: [ownerAnswers[0]] }))
        .expect(401);
    });

    it('le titulaire voit la demande (/me) et peut l’annuler (« Ce n’est pas moi »)', async () => {
      const o = await newOwner();
      await client(app).post('/auth/staff/recover/questions').send(body(o.phone)).expect(202);
      const me = await o.http.get('/auth/staff/me').set(bearer(o.token)).expect(200);
      expect(me.body.recoveryPending.availableAt).toEqual(expect.any(String));

      const cancelled = await o.http
        .post('/auth/staff/recover/cancel')
        .set(bearer(o.token))
        .expect(200);
      expect(cancelled.body.cancelled).toBe(1);
      const after = await o.http.get('/auth/staff/me').set(bearer(o.token)).expect(200);
      expect(after.body.recoveryPending).toBeNull();
    });

    it('une nouvelle demande remplace la précédente', async () => {
      const o = await newOwner();
      await client(app).post('/auth/staff/recover/questions').send(body(o.phone)).expect(202);
      await client(app)
        .post('/auth/staff/recover/questions')
        .send(body(o.phone, { newPin: '246813', newPinConfirm: '246813' }))
        .expect(202);
      const requests = await prisma.recoveryRequest.findMany({ where: { userId: o.userId } });
      expect(requests.filter((r) => r.status === 'PENDING')).toHaveLength(1);
      expect(requests.filter((r) => r.cancelledBy === 'superseded')).toHaveLength(1);
    });

    it('un gérant voit la demande de son employé et peut l’annuler', async () => {
      const o = await newOwner();
      const phone = uniquePhone();
      const added = await o.http
        .post(`/restaurants/${o.restaurantId}/team`)
        .set(bearer(o.token))
        .send({ name: 'Jean Nkoulou', phone, role: 'WAITER' })
        .expect(201);
      const memberId = added.body.member.userId as string;
      // L'employé ajoute une récupération par questions : il lui faut un profil.
      await prisma.recoveryProfile.create({
        data: {
          userId: memberId,
          birthDateHash: 'x',
        },
      });
      await prisma.recoveryRequest.create({
        data: { userId: memberId, newPinHash: 'x', availableAt: new Date(Date.now() + 3_600_000) },
      });

      const list = await o.http
        .get(`/restaurants/${o.restaurantId}/team`)
        .set(bearer(o.token))
        .expect(200);
      const row = list.body.find((m: { userId: string }) => m.userId === memberId);
      expect(row.recoveryPendingUntil).toEqual(expect.any(String));

      const res = await o.http
        .post(`/restaurants/${o.restaurantId}/team/${memberId}/cancel-recovery`)
        .set(bearer(o.token))
        .expect(200);
      expect(res.body.cancelled).toBe(1);
      const again = await o.http
        .get(`/restaurants/${o.restaurantId}/team`)
        .set(bearer(o.token))
        .expect(200);
      expect(
        again.body.find((m: { userId: string }) => m.userId === memberId).recoveryPendingUntil,
      ).toBeNull();
    });
  });

  describe('finalisation d’une récupération différée', () => {
    async function pendingOwner() {
      const o = await newOwner();
      await client(app)
        .post('/auth/staff/recover/questions')
        .send({
          phone: o.phone,
          birthDate: ownerBirth,
          recoveryAnswers: ownerAnswers,
          newPin: NEW_PIN,
          newPinConfirm: NEW_PIN,
        })
        .expect(202);
      return o;
    }
    const makeDue = (userId: string) =>
      prisma.recoveryRequest.updateMany({
        where: { userId, status: 'PENDING' },
        data: { availableAt: new Date(Date.now() - 1000) },
      });

    it('409 avant l’échéance, avec la date', async () => {
      const o = await pendingOwner();
      const res = await client(app)
        .post('/auth/staff/recover/complete')
        .send({ phone: o.phone, newPin: NEW_PIN })
        .expect(409);
      expect(res.body.message).toBe('recovery.notYetAvailable');
      expect(res.body.availableAt).toEqual(expect.any(String));
      await client(app)
        .post('/auth/staff/login')
        .send({ phone: o.phone, pin: NEW_PIN })
        .expect(401);
    });

    it('après l’échéance : nouveau PIN actif, anciennes sessions coupées, session neuve', async () => {
      const o = await pendingOwner();
      await makeDue(o.userId);
      const res = await client(app)
        .post('/auth/staff/recover/complete')
        .send({ phone: o.phone, newPin: NEW_PIN })
        .expect(200);
      expect(res.body.accessToken).toEqual(expect.any(String));

      await client(app).post('/auth/staff/login').send({ phone: o.phone, pin: PIN }).expect(401);
      await client(app)
        .post('/auth/staff/login')
        .send({ phone: o.phone, pin: NEW_PIN })
        .expect(200);
      expect(
        await prisma.recoveryRequest.count({ where: { userId: o.userId, status: 'COMPLETED' } }),
      ).toBe(1);
      // Un compte récupéré par questions n'est pas « restreint » côté personnel.
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: o.userId } })).restrictedUntil,
      ).toBeNull();
    });

    it('ne se rejoue pas', async () => {
      const o = await pendingOwner();
      await makeDue(o.userId);
      await client(app)
        .post('/auth/staff/recover/complete')
        .send({ phone: o.phone, newPin: NEW_PIN })
        .expect(200);
      await client(app)
        .post('/auth/staff/recover/complete')
        .send({ phone: o.phone, newPin: NEW_PIN })
        .expect(401);
    });

    it('exige le PIN choisi au départ', async () => {
      const o = await pendingOwner();
      await makeDue(o.userId);
      await client(app)
        .post('/auth/staff/recover/complete')
        .send({ phone: o.phone, newPin: '999990' })
        .expect(401);
      await client(app).post('/auth/staff/login').send({ phone: o.phone, pin: PIN }).expect(200);
    });

    it('une demande annulée ne peut pas être finalisée', async () => {
      const o = await pendingOwner();
      await makeDue(o.userId);
      await o.http.post('/auth/staff/recover/cancel').set(bearer(o.token)).expect(200);
      await client(app)
        .post('/auth/staff/recover/complete')
        .send({ phone: o.phone, newPin: NEW_PIN })
        .expect(401);
    });

    it('une demande trop ancienne (plus de 7 jours après l’échéance) est périmée', async () => {
      const o = await pendingOwner();
      await prisma.recoveryRequest.updateMany({
        where: { userId: o.userId },
        data: { availableAt: new Date(Date.now() - 8 * 24 * 3_600_000) },
      });
      await client(app)
        .post('/auth/staff/recover/complete')
        .send({ phone: o.phone, newPin: NEW_PIN })
        .expect(401);
    });

    it('un inconnu reçoit le même 401', async () => {
      const o = await pendingOwner();
      await makeDue(o.userId);
      const known = await client(app)
        .post('/auth/staff/recover/complete')
        .send({ phone: o.phone, newPin: '999990' })
        .expect(401);
      const unknown = await client(app)
        .post('/auth/staff/recover/complete')
        .send({ phone: uniquePhone(), newPin: NEW_PIN })
        .expect(401);
      expect(known.body).toEqual(unknown.body);
    });
  });

  describe('annulation et code de secours (connecté)', () => {
    it('/recover/cancel exige d’être connecté', async () => {
      await client(app).post('/auth/staff/recover/cancel').expect(401);
      const c = await newCustomer();
      await client(app).post('/auth/staff/recover/cancel').set(bearer(c.token)).expect(401);
    });

    it('/recover/cancel sans demande en attente renvoie 0', async () => {
      const c = await newCustomer();
      const res = await client(app)
        .post('/auth/customer/recover/cancel')
        .set(bearer(c.token))
        .expect(200);
      expect(res.body.cancelled).toBe(0);
    });

    it('régénère le code de secours après confirmation du PIN ; l’ancien meurt', async () => {
      const c = await newCustomer();
      const res = await client(app)
        .post('/auth/customer/recovery-code')
        .set(bearer(c.token))
        .send({ pin: PIN })
        .expect(200);
      expect(res.body.recoveryCode).not.toBe(c.recoveryCode);
      const recover = (code: string) =>
        client(app)
          .post('/auth/customer/recover/code')
          .send({ phone: c.phone, recoveryCode: code, newPin: NEW_PIN, newPinConfirm: NEW_PIN });
      await recover(c.recoveryCode).expect(401);
      await recover(res.body.recoveryCode).expect(200);
    });

    it('refuse un mauvais PIN et exige d’être connecté', async () => {
      const c = await newCustomer();
      await client(app)
        .post('/auth/customer/recovery-code')
        .set(bearer(c.token))
        .send({ pin: '000001' })
        .expect(401);
      await client(app).post('/auth/customer/recovery-code').send({ pin: PIN }).expect(401);
      await client(app)
        .post('/auth/customer/recovery-code')
        .set(bearer(c.token))
        .send({ pin: 'abc' })
        .expect(400);
    });
  });

  describe('isolation entre restaurants', () => {
    it('un gérant ne peut pas annuler la récupération d’un employé d’un autre restaurant', async () => {
      const a = await newOwner();
      const b = await newOwner();
      const added = await a.http
        .post(`/restaurants/${a.restaurantId}/team`)
        .set(bearer(a.token))
        .send({ name: 'Jean Nkoulou', phone: uniquePhone(), role: 'WAITER' })
        .expect(201);
      await prisma.recoveryRequest.create({
        data: {
          userId: added.body.member.userId,
          newPinHash: 'x',
          availableAt: new Date(Date.now() + 3_600_000),
        },
      });
      await b.http
        .post(`/restaurants/${b.restaurantId}/team/${added.body.member.userId}/cancel-recovery`)
        .set(bearer(b.token))
        .expect(404);
      await b.http
        .post(`/restaurants/${a.restaurantId}/team/${added.body.member.userId}/cancel-recovery`)
        .set(bearer(b.token))
        .expect(404);
      expect(
        await prisma.recoveryRequest.count({
          where: { userId: added.body.member.userId, status: 'PENDING' },
        }),
      ).toBe(1);
    });

    it('un serveur ne peut pas annuler la récupération d’un collègue (403)', async () => {
      const o = await newOwner();
      const add = async (name: string) => {
        const phone = uniquePhone();
        const r = await o.http
          .post(`/restaurants/${o.restaurantId}/team`)
          .set(bearer(o.token))
          .send({ name, phone, role: 'WAITER' })
          .expect(201);
        const login = await client(app)
          .post('/auth/staff/login')
          .send({ phone, pin: r.body.temporaryPin })
          .expect(200);
        const fresh = await client(app)
          .post('/auth/staff/pin')
          .set(bearer(login.body.accessToken))
          .send({ currentPin: r.body.temporaryPin, newPin: NEW_PIN, newPinConfirm: NEW_PIN })
          .expect(200);
        return { id: r.body.member.userId as string, token: fresh.body.accessToken as string };
      };
      const w1 = await add('Serveur Un');
      const w2 = await add('Serveur Deux');
      await o.http
        .post(`/restaurants/${o.restaurantId}/team/${w2.id}/cancel-recovery`)
        .set(bearer(w1.token))
        .expect(403);
    });
  });
});
