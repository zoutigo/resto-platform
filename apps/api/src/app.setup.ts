import type { INestApplication } from '@nestjs/common';

/** Configuration commune à l'application réelle (main.ts) et aux tests fonctionnels. */
export function configureApp(app: INestApplication): void {
  app.enableCors({ origin: true });
}
