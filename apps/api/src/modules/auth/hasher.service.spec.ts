import { describe, expect, it } from 'vitest';
import { loadAuthConfig } from './auth.config.js';
import { HasherService } from './hasher.service.js';

const config = loadAuthConfig();
const hasher = new HasherService(config);

describe('HasherService — secrets', () => {
  it('hache en Argon2id et vérifie', async () => {
    const hash = await hasher.hashSecret('483920');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('483920');
    expect(await hasher.verifySecret(hash, '483920')).toBe(true);
    expect(await hasher.verifySecret(hash, '483921')).toBe(false);
  });

  it('sale chaque empreinte', async () => {
    const [a, b] = await Promise.all([hasher.hashSecret('483920'), hasher.hashSecret('483920')]);
    expect(a).not.toBe(b);
  });

  it('dépend du pepper : une autre clé ne vérifie pas', async () => {
    const hash = await hasher.hashSecret('483920');
    const other = new HasherService({ ...config, pepper: Buffer.from('autre-pepper-'.repeat(4)) });
    expect(await other.verifySecret(hash, '483920')).toBe(false);
  });

  it('renvoie false (sans lever) sur une empreinte illisible', async () => {
    expect(await hasher.verifySecret('pas-un-hash', '483920')).toBe(false);
  });
});

describe('HasherService — jetons et codes', () => {
  it('fingerprint est déterministe et hexadécimal', () => {
    const a = hasher.fingerprint('jeton');
    expect(a).toBe(hasher.fingerprint('jeton'));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(hasher.fingerprint('jeton2'));
  });

  it('génère un code de secours XXXX-XXXX-XXXX sans caractères ambigus', () => {
    for (let i = 0; i < 50; i++) {
      const code = hasher.generateRecoveryCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });

  it('génère des codes distincts', () => {
    const codes = new Set(Array.from({ length: 100 }, () => hasher.generateRecoveryCode()));
    expect(codes.size).toBe(100);
  });

  it('normalise la saisie du code (casse, tirets, espaces)', () => {
    expect(hasher.normalizeRecoveryCode('abcd-efgh-jkmn')).toBe('ABCDEFGHJKMN');
    expect(hasher.normalizeRecoveryCode(' ABCD EFGH JKMN ')).toBe('ABCDEFGHJKMN');
  });

  it.each(['', 'ABCD', 'ABCD-EFGH-JKMN-PQRS', 'ABCD-EFGH-JKM0', 'ABCD-EFGH-JKMI'])(
    'refuse le code « %s »',
    (code) => {
      expect(hasher.normalizeRecoveryCode(code)).toBeNull();
    },
  );
});
