import type { Request, Response } from 'express';
import type { AuthConfig } from './auth.config.js';
import type { AuthContext } from './auth.service.js';
import type { IssuedSession } from './session.service.js';
import type { Audience } from './token.service.js';

const NATIVE_HEADER = 'x-client';

export const cookieName = (audience: Audience) => `resto_${audience}_rt`;
export const isNative = (req: Request) => req.headers[NATIVE_HEADER] === 'native';

export const contextOf = (req: Request): AuthContext => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  deviceId: typeof req.headers['x-device-id'] === 'string' ? req.headers['x-device-id'] : null,
});

export function cookieOptions(config: AuthConfig, audience: Audience) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.secureCookies,
    path: `/auth/${audience}`,
  };
}

/** Jeton de rafraîchissement : cookie pour le web, corps de requête pour le mobile natif. */
export function readRefreshToken(
  audience: Audience,
  req: Request,
  body: { refreshToken?: string } | undefined,
): string | undefined {
  if (isNative(req)) return typeof body?.refreshToken === 'string' ? body.refreshToken : undefined;
  const cookie = (req.cookies as Record<string, string> | undefined)?.[cookieName(audience)];
  return typeof cookie === 'string' ? cookie : undefined;
}

/** Pose le cookie (web) ou renvoie le refresh token (natif) ; jamais les deux. */
export function deliverSession(
  config: AuthConfig,
  audience: Audience,
  req: Request,
  res: Response,
  session: IssuedSession,
) {
  const base = { accessToken: session.accessToken, expiresIn: session.expiresIn };
  if (isNative(req)) return { ...base, refreshToken: session.refreshToken };
  res.cookie(cookieName(audience), session.refreshToken, {
    ...cookieOptions(config, audience),
    maxAge: session.refreshTtlSeconds * 1000,
  });
  return base;
}
