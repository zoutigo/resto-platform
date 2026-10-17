import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma.service.js';
import { PIN, client, customerBody, ownerBody, uniquePhone } from './auth-helpers.js';
import { createTestApp } from './helpers.js';

describe('Restaurants, rôles et équipe (vraie base resto_test)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Propriétaire inscrit avec son restaurant. */
  async function owner(name = 'Chez Mama') {
    const http = client(app);
    const reg = await http.post('/auth/staff/register').send(ownerBody()).expect(201);
    const token = reg.body.accessToken as string;
    const created = await http
      .post('/restaurants')
      .set(bearer(token))
      .send({ name, city: 'Douala' })
      .expect(201);
    return { http, token, userId: reg.body.user.id as string, restaurant: created.body };
  }

  /** Ajoute un employé et le connecte avec son PIN temporaire. */
  async function staffMember(
    ctx: Awaited<ReturnType<typeof owner>>,
    role: string,
    name = 'Jean Nkoulou',
  ) {
    const phone = uniquePhone();
    const added = await ctx.http
      .post(`/restaurants/${ctx.restaurant.id}/team`)
      .set(bearer(ctx.token))
      .send({ name, phone, role })
      .expect(201);
    const login = await client(app)
      .post('/auth/staff/login')
      .send({ phone, pin: added.body.temporaryPin })
      .expect(200);
    return {
      phone,
      userId: added.body.member.userId as string,
      temporaryPin: added.body.temporaryPin as string,
      token: login.body.accessToken as string,
    };
  }

  /** Change le PIN temporaire pour obtenir un jeton pleinement utilisable. */
  async function activate(m: { phone: string; temporaryPin: string; token: string }) {
    const res = await client(app)
      .post('/auth/staff/pin')
      .set(bearer(m.token))
      .send({ currentPin: m.temporaryPin, newPin: '715204', newPinConfirm: '715204' })
      .expect(200);
    return res.body.accessToken as string;
  }

  describe('création d’un restaurant', () => {
    it('fait du créateur le propriétaire et le liste dans /mine et /me', async () => {
      const { http, token, restaurant } = await owner('Le Fouquet’s 237');
      expect(restaurant).toMatchObject({
        name: 'Le Fouquet’s 237',
        city: 'Douala',
        slug: 'le-fouquet-s-237',
      });
      expect(restaurant).not.toHaveProperty('openingHours');

      const mine = await http.get('/restaurants/mine').set(bearer(token)).expect(200);
      expect(mine.body).toEqual([{ role: 'OWNER', restaurant }]);
      const me = await http.get('/auth/staff/me').set(bearer(token)).expect(200);
      expect(me.body.memberships).toEqual([{ restaurantId: restaurant.id, role: 'OWNER' }]);
    });

    it('génère un slug distinct quand le nom est déjà pris', async () => {
      const a = await owner('Resto Doublon');
      const b = await owner('Resto Doublon');
      expect(a.restaurant.slug).toBe('resto-doublon');
      expect(b.restaurant.slug).toMatch(/^resto-doublon-[0-9a-f]{4}$/);
    });

    it('exige un jeton du personnel (un jeton client est refusé)', async () => {
      const http = client(app);
      await http.post('/restaurants').send({ name: 'X Resto', city: 'Douala' }).expect(401);
      const cust = await http.post('/auth/customer/register').send(customerBody()).expect(201);
      await http
        .post('/restaurants')
        .set(bearer(cust.body.accessToken))
        .send({ name: 'X Resto', city: 'Douala' })
        .expect(401);
    });

    it.each([
      [{ name: 'A', city: 'Douala' }],
      [{ name: '!!!', city: 'Douala' }],
      [{ name: 'Chez Mama', city: '' }],
      [{}],
    ])('400 sur %j', async (body) => {
      const reg = await client(app).post('/auth/staff/register').send(ownerBody()).expect(201);
      await client(app)
        .post('/restaurants')
        .set(bearer(reg.body.accessToken))
        .send(body)
        .expect(400);
    });

    it('limite les créations répétées (429)', async () => {
      const reg = await client(app).post('/auth/staff/register').send(ownerBody()).expect(201);
      const http = client(app);
      for (let i = 0; i < 5; i++) {
        await http
          .post('/restaurants')
          .set(bearer(reg.body.accessToken))
          .send({ name: `Resto ${i} Test`, city: 'Douala' })
          .expect(201);
      }
      await http
        .post('/restaurants')
        .set(bearer(reg.body.accessToken))
        .send({ name: 'Resto de trop', city: 'Douala' })
        .expect(429);
    });
  });

  describe('isolation entre restaurants', () => {
    it('un autre propriétaire ne voit ni ne gère le restaurant (404 indiscernable)', async () => {
      const a = await owner('Resto A');
      const b = await owner('Resto B');
      const rid = a.restaurant.id;
      const ghost = '019aaaaa-0000-7000-8000-000000000000';

      const foreign = await b.http.get(`/restaurants/${rid}`).set(bearer(b.token)).expect(404);
      const missing = await b.http.get(`/restaurants/${ghost}`).set(bearer(b.token)).expect(404);
      expect(foreign.body).toEqual(missing.body);

      await b.http.get(`/restaurants/${rid}/team`).set(bearer(b.token)).expect(404);
      await b.http
        .post(`/restaurants/${rid}/team`)
        .set(bearer(b.token))
        .send({ name: 'Intrus Total', phone: uniquePhone(), role: 'WAITER' })
        .expect(404);
    });

    it('un identifiant de membre d’un autre restaurant ne contourne rien', async () => {
      const a = await owner('Resto A');
      const b = await owner('Resto B');
      const memberOfA = await staffMember(a, 'WAITER');

      // B vise l'employé de A via SON propre restaurant : introuvable, jamais modifié.
      const base = `/restaurants/${b.restaurant.id}/team/${memberOfA.userId}`;
      await b.http.patch(base).set(bearer(b.token)).send({ role: 'CASHIER' }).expect(404);
      await b.http.post(`${base}/reset-pin`).set(bearer(b.token)).expect(404);
      await b.http.delete(base).set(bearer(b.token)).expect(404);

      const row = await prisma.membership.findUniqueOrThrow({
        where: { userId_restaurantId: { userId: memberOfA.userId, restaurantId: a.restaurant.id } },
      });
      expect(row).toMatchObject({ role: 'WAITER', status: 'ACTIVE' });
      // Son PIN temporaire fonctionne toujours : B n'a rien réinitialisé.
      await client(app)
        .post('/auth/staff/login')
        .send({ phone: memberOfA.phone, pin: memberOfA.temporaryPin })
        .expect(200);
    });

    it('la liste d’équipe ne contient que les membres du restaurant', async () => {
      const a = await owner('Resto A');
      const b = await owner('Resto B');
      const inA = await staffMember(a, 'WAITER', 'Serveur Alpha');
      const inB = await staffMember(b, 'CASHIER', 'Caissier Beta');
      const list = await a.http
        .get(`/restaurants/${a.restaurant.id}/team`)
        .set(bearer(a.token))
        .expect(200);
      const ids = list.body.map((m: { userId: string }) => m.userId);
      expect(ids).toContain(inA.userId);
      expect(ids).not.toContain(inB.userId);
    });

    it('un employé d’un restaurant n’accède pas à un autre', async () => {
      const a = await owner('Resto A');
      const b = await owner('Resto B');
      const waiterOfA = await staffMember(a, 'WAITER');
      const token = await activate(waiterOfA);
      await a.http.get(`/restaurants/${b.restaurant.id}`).set(bearer(token)).expect(404);
      await a.http.get(`/restaurants/${a.restaurant.id}`).set(bearer(token)).expect(200);
    });
  });

  describe('rôles', () => {
    it('un serveur, un caissier ou un préparateur ne gère pas l’équipe (403)', async () => {
      const o = await owner();
      for (const role of ['WAITER', 'CASHIER', 'PREPARATOR']) {
        const member = await staffMember(o, role);
        const token = await activate(member);
        const base = `/restaurants/${o.restaurant.id}/team`;
        await o.http.get(base).set(bearer(token)).expect(403);
        await o.http
          .post(base)
          .set(bearer(token))
          .send({ name: 'Autre Employe', phone: uniquePhone(), role: 'WAITER' })
          .expect(403);
        await o.http.post(`${base}/${member.userId}/reset-pin`).set(bearer(token)).expect(403);
      }
    });

    it('un gérant gère le service mais ni un autre gérant ni le propriétaire', async () => {
      const o = await owner();
      const sup = await staffMember(o, 'SUPERVISOR', 'Gérant Un');
      const supToken = await activate(sup);
      const base = `/restaurants/${o.restaurant.id}/team`;

      await o.http.get(base).set(bearer(supToken)).expect(200);
      const waiter = await o.http
        .post(base)
        .set(bearer(supToken))
        .send({ name: 'Serveur Neuf', phone: uniquePhone(), role: 'WAITER' })
        .expect(201);
      await o.http
        .post(`${base}/${waiter.body.member.userId}/reset-pin`)
        .set(bearer(supToken))
        .expect(200);

      await o.http
        .post(base)
        .set(bearer(supToken))
        .send({ name: 'Gérant Deux', phone: uniquePhone(), role: 'SUPERVISOR' })
        .expect(403);
      await o.http.post(`${base}/${o.userId}/reset-pin`).set(bearer(supToken)).expect(403);
      await o.http.delete(`${base}/${o.userId}`).set(bearer(supToken)).expect(403);
      await o.http
        .patch(`${base}/${waiter.body.member.userId}`)
        .set(bearer(supToken))
        .send({ role: 'SUPERVISOR' })
        .expect(403);
    });

    it('personne ne retire ni ne rétrograde le propriétaire, pas même lui-même', async () => {
      const o = await owner();
      const base = `/restaurants/${o.restaurant.id}/team`;
      await o.http.delete(`${base}/${o.userId}`).set(bearer(o.token)).expect(403);
      await o.http
        .patch(`${base}/${o.userId}`)
        .set(bearer(o.token))
        .send({ role: 'WAITER' })
        .expect(403);
      await o.http.post(`${base}/${o.userId}/reset-pin`).set(bearer(o.token)).expect(403);
    });

    it('le rôle OWNER ne s’attribue pas par l’API', async () => {
      const o = await owner();
      await o.http
        .post(`/restaurants/${o.restaurant.id}/team`)
        .set(bearer(o.token))
        .send({ name: 'Faux Patron', phone: uniquePhone(), role: 'OWNER' })
        .expect(400);
    });

    it('un jeton client ou absent est refusé sur les routes d’équipe', async () => {
      const o = await owner();
      const cust = await o.http.post('/auth/customer/register').send(customerBody()).expect(201);
      const base = `/restaurants/${o.restaurant.id}/team`;
      await o.http.get(base).expect(401);
      await o.http.get(base).set(bearer(cust.body.accessToken)).expect(401);
    });
  });

  describe('gestion de l’équipe', () => {
    it('ajoute un employé : PIN temporaire unique, changement obligatoire', async () => {
      const o = await owner();
      const phone = uniquePhone();
      const res = await o.http
        .post(`/restaurants/${o.restaurant.id}/team`)
        .set(bearer(o.token))
        .send({ name: 'Marie Ebogo', phone, role: 'CASHIER' })
        .expect(201);
      expect(res.body.temporaryPin).toMatch(/^\d{6}$/);
      expect(res.body.member).toMatchObject({
        name: 'Marie Ebogo',
        phone,
        role: 'CASHIER',
        mustChangePin: true,
        pinResettable: true,
      });

      // Le PIN n'est jamais relisible ensuite.
      const list = await o.http
        .get(`/restaurants/${o.restaurant.id}/team`)
        .set(bearer(o.token))
        .expect(200);
      expect(JSON.stringify(list.body)).not.toContain(res.body.temporaryPin);

      const login = await client(app)
        .post('/auth/staff/login')
        .send({ phone, pin: res.body.temporaryPin })
        .expect(200);
      expect(login.body.mustChangePin).toBe(true);
    });

    it('bloque un compte au PIN temporaire (403) jusqu’au changement du PIN', async () => {
      const o = await owner();
      const m = await staffMember(o, 'WAITER');
      await o.http.get(`/restaurants/${o.restaurant.id}`).set(bearer(m.token)).expect(403);
      await o.http.get('/restaurants/mine').set(bearer(m.token)).expect(403);
      // Profil et changement de PIN restent accessibles.
      const me = await o.http.get('/auth/staff/me').set(bearer(m.token)).expect(200);
      expect(me.body.mustChangePin).toBe(true);

      const fresh = await activate(m);
      await o.http.get(`/restaurants/${o.restaurant.id}`).set(bearer(fresh)).expect(200);
      const after = await o.http.get('/auth/staff/me').set(bearer(fresh)).expect(200);
      expect(after.body.mustChangePin).toBe(false);
    });

    it('le refresh d’un compte au PIN temporaire reste restreint', async () => {
      const o = await owner();
      const phone = uniquePhone();
      const added = await o.http
        .post(`/restaurants/${o.restaurant.id}/team`)
        .set(bearer(o.token))
        .send({ name: 'Paul Biya', phone, role: 'WAITER' })
        .expect(201);
      const login = await client(app, { native: true })
        .post('/auth/staff/login')
        .send({ phone, pin: added.body.temporaryPin })
        .expect(200);
      const refreshed = await client(app, { native: true })
        .post('/auth/staff/refresh')
        .send({ refreshToken: login.body.refreshToken })
        .expect(200);
      await o.http
        .get(`/restaurants/${o.restaurant.id}`)
        .set(bearer(refreshed.body.accessToken))
        .expect(403);
    });

    it('rattache un compte existant sans créer de PIN ni le rendre réinitialisable', async () => {
      const o = await owner();
      const cust = await client(app)
        .post('/auth/customer/register')
        .send(customerBody())
        .expect(201);
      const phone = cust.body.user.phone as string;
      const res = await o.http
        .post(`/restaurants/${o.restaurant.id}/team`)
        .set(bearer(o.token))
        .send({ name: 'Awa Mbarga', phone, role: 'WAITER' })
        .expect(201);
      expect(res.body.temporaryPin).toBeNull();
      expect(res.body.member.pinResettable).toBe(false);

      // Il se connecte avec SON PIN et voit son nouveau rôle.
      const login = await client(app)
        .post('/auth/staff/login')
        .send({ phone, pin: PIN })
        .expect(200);
      expect(login.body.mustChangePin).toBe(false);
      const me = await o.http.get('/auth/staff/me').set(bearer(login.body.accessToken)).expect(200);
      expect(me.body.memberships).toEqual([{ restaurantId: o.restaurant.id, role: 'WAITER' }]);

      // Le restaurant ne peut pas prendre le contrôle de ce compte.
      await o.http
        .post(`/restaurants/${o.restaurant.id}/team/${cust.body.user.id}/reset-pin`)
        .set(bearer(o.token))
        .expect(403);
      await client(app).post('/auth/customer/login').send({ phone, pin: PIN }).expect(200);
    });

    it('refuse d’ajouter deux fois le même numéro (409)', async () => {
      const o = await owner();
      const m = await staffMember(o, 'WAITER');
      await o.http
        .post(`/restaurants/${o.restaurant.id}/team`)
        .set(bearer(o.token))
        .send({ name: 'Doublon Total', phone: m.phone, role: 'CASHIER' })
        .expect(409);
    });

    it.each([
      [{ name: 'J', phone: '655112233', role: 'WAITER' }],
      [{ name: 'Jean Nkoulou', phone: '123', role: 'WAITER' }],
      [{ name: 'Jean Nkoulou', phone: '655112233', role: 'BOSS' }],
      [{}],
    ])('400 sur %j', async (body) => {
      const o = await owner();
      await o.http
        .post(`/restaurants/${o.restaurant.id}/team`)
        .set(bearer(o.token))
        .send(body)
        .expect(400);
    });

    it('change le rôle d’un employé', async () => {
      const o = await owner();
      const m = await staffMember(o, 'WAITER');
      const res = await o.http
        .patch(`/restaurants/${o.restaurant.id}/team/${m.userId}`)
        .set(bearer(o.token))
        .send({ role: 'CASHIER' })
        .expect(200);
      expect(res.body.role).toBe('CASHIER');
      await o.http
        .patch(`/restaurants/${o.restaurant.id}/team/${m.userId}`)
        .set(bearer(o.token))
        .send({ role: 'OWNER' })
        .expect(400);
    });

    it('réinitialise le PIN : ancien PIN invalide, sessions coupées, changement exigé', async () => {
      const o = await owner();
      const m = await staffMember(o, 'WAITER');
      const fresh = await activate(m);
      await o.http.get(`/restaurants/${o.restaurant.id}`).set(bearer(fresh)).expect(200);

      const reset = await o.http
        .post(`/restaurants/${o.restaurant.id}/team/${m.userId}/reset-pin`)
        .set(bearer(o.token))
        .expect(200);
      expect(reset.body.temporaryPin).toMatch(/^\d{6}$/);

      await client(app)
        .post('/auth/staff/login')
        .send({ phone: m.phone, pin: '715204' })
        .expect(401);
      const login = await client(app)
        .post('/auth/staff/login')
        .send({ phone: m.phone, pin: reset.body.temporaryPin })
        .expect(200);
      expect(login.body.mustChangePin).toBe(true);

      const audit = await prisma.auditLog.findMany({
        where: { action: 'team.member.pinReset', userId: o.userId },
      });
      expect(audit.length).toBeGreaterThan(0);
      expect(JSON.stringify(audit)).not.toContain(reset.body.temporaryPin);
    });

    it('retirer un employé coupe l’accès immédiatement, même avec un jeton encore valide', async () => {
      const o = await owner();
      const m = await staffMember(o, 'WAITER');
      const token = await activate(m);
      await o.http.get(`/restaurants/${o.restaurant.id}`).set(bearer(token)).expect(200);

      await o.http
        .delete(`/restaurants/${o.restaurant.id}/team/${m.userId}`)
        .set(bearer(o.token))
        .expect(204);
      await o.http.get(`/restaurants/${o.restaurant.id}`).set(bearer(token)).expect(404);
      const list = await o.http
        .get(`/restaurants/${o.restaurant.id}/team`)
        .set(bearer(o.token))
        .expect(200);
      expect(list.body.map((x: { userId: string }) => x.userId)).not.toContain(m.userId);
      // Le compte existe toujours.
      expect(await prisma.user.findUnique({ where: { id: m.userId } })).not.toBeNull();
    });

    it('un employé retiré peut être ré-ajouté', async () => {
      const o = await owner();
      const m = await staffMember(o, 'WAITER');
      await o.http
        .delete(`/restaurants/${o.restaurant.id}/team/${m.userId}`)
        .set(bearer(o.token))
        .expect(204);
      const again = await o.http
        .post(`/restaurants/${o.restaurant.id}/team`)
        .set(bearer(o.token))
        .send({ name: 'Jean Nkoulou', phone: m.phone, role: 'CASHIER' })
        .expect(201);
      expect(again.body.member).toMatchObject({ role: 'CASHIER' });
      expect(again.body.temporaryPin).toBeNull();
    });
  });
});
