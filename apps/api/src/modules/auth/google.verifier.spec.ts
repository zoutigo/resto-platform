import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { JoseGoogleVerifier } from './google.verifier.js';

const CLIENT_ID = 'client-123.apps.googleusercontent.com';
let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let verifier: JoseGoogleVerifier;

async function token(
  claims: Record<string, unknown> = {},
  opts: { issuer?: string; audience?: string; expires?: string; key?: CryptoKey } = {},
) {
  return new SignJWT({
    email: 'awa@gmail.com',
    email_verified: true,
    name: 'Awa Mbarga',
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setSubject((claims.sub as string) ?? 'google-sub-1')
    .setIssuer(opts.issuer ?? 'https://accounts.google.com')
    .setAudience(opts.audience ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(opts.expires ?? '10m')
    .sign(opts.key ?? privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  otherPrivateKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  verifier = new JoseGoogleVerifier(CLIENT_ID, createLocalJWKSet({ keys: [jwk] }));
});

describe('JoseGoogleVerifier', () => {
  it('lit le profil d’un ID token valide', async () => {
    expect(await verifier.verify(await token())).toEqual({
      sub: 'google-sub-1',
      email: 'awa@gmail.com',
      emailVerified: true,
      name: 'Awa Mbarga',
    });
  });

  it('accepte l’émetteur sans schéma et passe l’email en minuscules', async () => {
    const t = await token({ email: 'Awa@Gmail.COM' }, { issuer: 'accounts.google.com' });
    expect((await verifier.verify(t)).email).toBe('awa@gmail.com');
  });

  it('signale un email non vérifié ou absent', async () => {
    expect((await verifier.verify(await token({ email_verified: false }))).emailVerified).toBe(
      false,
    );
    expect((await verifier.verify(await token({ email_verified: 'true' }))).emailVerified).toBe(
      false,
    );
    const noEmail = await verifier.verify(await token({ email: undefined }));
    expect(noEmail.email).toBeNull();
  });

  it('retombe sur la partie locale de l’email sans nom', async () => {
    expect((await verifier.verify(await token({ name: undefined }))).name).toBe('awa');
    expect((await verifier.verify(await token({ name: 'A' }))).name).toBe('awa');
  });

  it.each([
    ['mauvaise audience', () => token({}, { audience: 'autre-client' })],
    ['mauvais émetteur', () => token({}, { issuer: 'https://evil.example' })],
    ['jeton expiré', () => token({}, { expires: '-1m' })],
    ['mauvaise signature', () => token({}, { key: otherPrivateKey })],
    ['jeton mal formé', async () => 'pas.un.jwt'],
    ['jeton vide', async () => ''],
  ])('refuse : %s (401)', async (_l, make) => {
    await expect(verifier.verify(await make())).rejects.toMatchObject({
      status: 401,
      response: { message: 'google.invalidToken' },
    });
  });

  it('refuse un jeton non signé (alg none)', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'none' })}.${b64({ sub: 'x', iss: 'https://accounts.google.com', aud: CLIENT_ID })}.`;
    await expect(verifier.verify(unsigned)).rejects.toMatchObject({ status: 401 });
  });

  it('répond 503 quand Google n’est pas configuré', async () => {
    const unconfigured = new JoseGoogleVerifier(undefined, createLocalJWKSet({ keys: [] }));
    await expect(unconfigured.verify(await token())).rejects.toMatchObject({
      status: 503,
      response: { message: 'google.notConfigured' },
    });
  });
});
