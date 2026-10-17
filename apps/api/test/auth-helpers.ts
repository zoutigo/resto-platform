import { randomInt } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

/** Numéro mobile camerounais unique, au PIN « 6xx xxx xxx » jamais égal à un PIN de test. */
export const uniquePhone = () => `+2376${String(randomInt(10_000_000, 99_999_999))}`;

/** Chaque « client » de test a sa propre IP (TRUST_PROXY=1) : les compteurs ne se mélangent pas. */
export const uniqueIp = () => `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`;

export const PIN = '483920';

export const ownerBody = (over: Record<string, unknown> = {}) => ({
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
  ...over,
});

export const customerBody = (over: Record<string, unknown> = {}) => ({
  name: 'Awa Mbarga',
  phone: uniquePhone(),
  pin: PIN,
  pinConfirm: PIN,
  birthDate: { day: 5, month: 3, year: 1990 },
  recoveryAnswers: [{ question: 'BIRTH_CITY', answer: 'Douala' }],
  ...over,
});

export type Audience = 'staff' | 'customer';

/** Client HTTP avec IP fixe et, au choix, mode natif (refresh token dans le corps). */
export function client(app: INestApplication, opts: { ip?: string; native?: boolean } = {}) {
  const ip = opts.ip ?? uniqueIp();
  const withHeaders = (req: request.Test) => {
    req.set('X-Forwarded-For', ip);
    if (opts.native) req.set('x-client', 'native');
    return req;
  };
  const http = () => request(app.getHttpServer());
  return {
    ip,
    post: (path: string) => withHeaders(http().post(path)),
    get: (path: string) => withHeaders(http().get(path)),
  };
}

/** Extrait la valeur d'un cookie `name=…` des en-têtes Set-Cookie. */
export function cookieValue(res: request.Response, name: string): string | undefined {
  const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const line = raw.find((c) => c.startsWith(`${name}=`));
  return line?.split(';')[0]?.slice(name.length + 1);
}

export const setCookieLine = (res: request.Response, name: string): string | undefined =>
  ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${name}=`));
