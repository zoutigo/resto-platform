import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

describe('API — santé (vraie base resto_test)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health pingue la base', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
  });

  it('répond 404 sur une route inconnue', async () => {
    await request(app.getHttpServer()).get('/nope').expect(404);
  });
});

describe('API — support de test', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('expose les emails envoyés pendant les tests (NODE_ENV=test uniquement)', async () => {
    const email = `support${Date.now()}@example.cm`;
    await request(app.getHttpServer())
      .post('/auth/customer/register-email')
      .set('X-Forwarded-For', '10.9.9.9')
      .send({ name: 'Awa Mbarga', email, password: 'Soleil-2026', passwordConfirm: 'Soleil-2026' })
      .expect(202);
    const res = await request(app.getHttpServer())
      .get('/__test/emails')
      .query({ to: email })
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].code).toMatch(/^\d{6}$/);
  });
});
