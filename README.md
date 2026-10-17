# resto-platform

Monorepo npm workspaces + Turborepo.

| Chemin                 | Rôle                                                                    | Port |
| ---------------------- | ----------------------------------------------------------------------- | ---- |
| `apps/api`             | API NestJS                                                              | 4000 |
| `apps/backoffice`      | Back-office restaurant (Next.js, PWA à venir)                           | 3000 |
| `apps/storefront`      | Vitrine client (Next.js)                                                | 3001 |
| `packages/shared`      | Types, règles métier, schémas Zod partagés avec l'API, client API       | -    |
| `packages/ui`          | Composants shadcn/ui, thème, i18n FR/EN, formulaires d'authentification | -    |
| `packages/e2e-support` | Configuration Playwright et assistants des tests d'interface            | -    |

## Démarrage

```bash
nvm use            # Node 22
npm install
cp .env.example .env
npm run db:up         # Postgres + Redis (Docker)
npm run dev
```

Vérifications : `npm run build`, `npm run typecheck`, `npm run format:check`.

Données de démonstration (restaurant « Chez Mama Africa » et un compte par rôle, PIN `483920`) : `npm run db:seed -w @resto/api`. Comptes : +237 690000001 (propriétaire), …02 (gérant), …03 (serveur), …04 (caissier), …05 (cuisinier), …06 (client).

Variables d'authentification : voir `.env.example` (`AUTH_JWT_SECRET` et `AUTH_PEPPER` sont obligatoires, 32 caractères minimum). Les emails de code s'affichent dans la console de l'API en développement ; en production, renseigner `SMTP_URL`.

Tests : `npm test` (unitaires), `npm run test:e2e` (fonctionnels : API + Playwright mobile et desktop ; Postgres doit tourner).

Base de données : Postgres sur le port **5433** et Redis sur **6380** (décalés pour ne pas entrer en conflit avec d'autres projets). Migrations : `npm run db:migrate -w @resto/api`.

## Prochaines étapes

Catalogue, commandes, hors-ligne (IndexedDB + outbox idempotente).
