import { createHash, randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { Inject, Injectable } from '@nestjs/common';
import { AUTH_CONFIG, type AuthConfig } from './auth.config.js';

// Argon2id, paramètres OWASP (19 Mio, 2 passes, 1 voie). Le pepper reste hors base de données.
const ARGON2 = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

// Sans I, O, 0, 1 (confusions à la lecture) : 32 symboles, soit 60 bits pour 12 caractères.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12;

@Injectable()
export class HasherService {
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  /** Hache un secret faible en entropie (PIN, date, réponse) : sel aléatoire + pepper. */
  hashSecret(secret: string): Promise<string> {
    return hash(secret, { ...ARGON2, secret: this.config.pepper });
  }

  async verifySecret(hashed: string, secret: string): Promise<boolean> {
    try {
      return await verify(hashed, secret, { secret: this.config.pepper });
    } catch {
      return false;
    }
  }

  /** Empreinte déterministe d'un jeton aléatoire fort (refresh token) : SHA-256 suffit. */
  fingerprint(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Code de secours lisible : `XXXX-XXXX-XXXX`, tirage sans biais. */
  generateRecoveryCode(): string {
    const chars = Array.from(
      { length: CODE_LENGTH },
      () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
    );
    return [0, 4, 8].map((i) => chars.slice(i, i + 4).join('')).join('-');
  }

  /** Ignore casse, tirets et espaces ; renvoie null si le format est impossible. */
  normalizeRecoveryCode(input: string): string | null {
    const code = input.toUpperCase().replace(/[\s-]/g, '');
    if (code.length !== CODE_LENGTH) return null;
    return [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : null;
  }

  /** Date de naissance `YYYY-MM-DD` ou réponse normalisée → même traitement. */
  hashRecoveryValue(value: string): Promise<string> {
    return this.hashSecret(value);
  }
}
