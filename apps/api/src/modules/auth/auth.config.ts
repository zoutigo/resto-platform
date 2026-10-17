import { z } from 'zod';

const envSchema = z.object({
  AUTH_JWT_SECRET: z.string().min(32, 'AUTH_JWT_SECRET: 32 caractères minimum'),
  AUTH_PEPPER: z.string().min(32, 'AUTH_PEPPER: 32 caractères minimum'),
  WEB_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001'),
  NODE_ENV: z.string().optional(),
});

export interface AuthConfig {
  jwtSecret: Uint8Array;
  pepper: Buffer;
  webOrigins: string[];
  secureCookies: boolean;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

/** Lit et valide l'environnement : l'API refuse de démarrer sans secrets suffisants. */
export function loadAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  const parsed = envSchema.parse(env);
  return {
    jwtSecret: new TextEncoder().encode(parsed.AUTH_JWT_SECRET),
    pepper: Buffer.from(parsed.AUTH_PEPPER),
    webOrigins: parsed.WEB_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    secureCookies: parsed.NODE_ENV === 'production',
    accessTtlSeconds: 15 * 60,
    refreshTtlSeconds: 60 * 24 * 60 * 60,
  };
}
