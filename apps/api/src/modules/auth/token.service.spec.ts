import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAuthConfig } from './auth.config.js';
import { TokenService } from './token.service.js';

const config = loadAuthConfig();
const tokens = new TokenService(config);

afterEach(() => {
  vi.useRealTimers();
});

describe('TokenService', () => {
  it('signe puis vérifie un jeton d’accès', async () => {
    const jwt = await tokens.signAccess({ userId: 'u1', audience: 'staff', mustChangePin: false });
    expect(await tokens.verifyAccess(jwt, 'staff')).toEqual({
      userId: 'u1',
      audience: 'staff',
      mustChangePin: false,
    });
  });

  it('porte l’obligation de changer le PIN', async () => {
    const jwt = await tokens.signAccess({ userId: 'u1', audience: 'staff', mustChangePin: true });
    expect(await tokens.verifyAccess(jwt, 'staff')).toMatchObject({ mustChangePin: true });
  });

  it('refuse un jeton client sur l’espace personnel (et inversement)', async () => {
    const customer = await tokens.signAccess({
      userId: 'u1',
      audience: 'customer',
      mustChangePin: false,
    });
    await expect(tokens.verifyAccess(customer, 'staff')).rejects.toMatchObject({ status: 401 });
    const staff = await tokens.signAccess({
      userId: 'u1',
      audience: 'staff',
      mustChangePin: false,
    });
    await expect(tokens.verifyAccess(staff, 'customer')).rejects.toMatchObject({ status: 401 });
  });

  it('refuse un jeton expiré', async () => {
    vi.useFakeTimers();
    const jwt = await tokens.signAccess({ userId: 'u1', audience: 'staff', mustChangePin: false });
    vi.setSystemTime(Date.now() + (config.accessTtlSeconds + 5) * 1000);
    await expect(tokens.verifyAccess(jwt, 'staff')).rejects.toMatchObject({ status: 401 });
  });

  it('refuse un jeton signé avec un autre secret', async () => {
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u1')
      .setAudience('staff')
      .setIssuer('resto-api')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('un-autre-secret-de-plus-de-32-caracteres'));
    await expect(tokens.verifyAccess(forged, 'staff')).rejects.toMatchObject({ status: 401 });
  });

  it('refuse un jeton altéré, vide ou mal formé', async () => {
    const jwt = await tokens.signAccess({ userId: 'u1', audience: 'staff', mustChangePin: false });
    await expect(tokens.verifyAccess(`${jwt}x`, 'staff')).rejects.toMatchObject({ status: 401 });
    await expect(tokens.verifyAccess('', 'staff')).rejects.toMatchObject({ status: 401 });
    await expect(tokens.verifyAccess('a.b.c', 'staff')).rejects.toMatchObject({ status: 401 });
  });

  it('refuse un jeton sans sujet', async () => {
    const noSub = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('staff')
      .setIssuer('resto-api')
      .setExpirationTime('5m')
      .sign(config.jwtSecret);
    await expect(tokens.verifyAccess(noSub, 'staff')).rejects.toMatchObject({ status: 401 });
  });

  it('refuse un jeton d’un autre émetteur', async () => {
    const other = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u1')
      .setAudience('staff')
      .setIssuer('autre')
      .setExpirationTime('5m')
      .sign(config.jwtSecret);
    await expect(tokens.verifyAccess(other, 'staff')).rejects.toMatchObject({ status: 401 });
  });

  it('génère des refresh tokens longs et uniques', () => {
    const a = tokens.generateRefreshToken();
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(a).not.toBe(tokens.generateRefreshToken());
  });
});
