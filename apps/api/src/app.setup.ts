import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { loadAuthConfig } from './modules/auth/auth.config.js';

/** Configuration commune à l'application réelle (main.ts) et aux tests fonctionnels. */
export function configureApp(app: INestApplication): void {
  const { webOrigins } = loadAuthConfig();
  // Derrière un proxy (Caddy/Nginx), TRUST_PROXY=1 pour lire la vraie IP du client.
  if (process.env.TRUST_PROXY) {
    app.getHttpAdapter().getInstance().set('trust proxy', Number(process.env.TRUST_PROXY));
  }
  app.use(cookieParser());
  app.enableCors({ origin: webOrigins, credentials: true });
}
