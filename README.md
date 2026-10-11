# resto-platform

Monorepo npm workspaces + Turborepo.

| Chemin            | Rôle                                                              | Port |
| ----------------- | ----------------------------------------------------------------- | ---- |
| `apps/api`        | API NestJS                                                        | 4000 |
| `apps/backoffice` | Back-office restaurant (Next.js, PWA à venir)                     | 3000 |
| `apps/storefront` | Vitrine client (Next.js)                                          | 3001 |
| `packages/shared` | Types, règles métier (machine à états des commandes), utilitaires | -    |

## Démarrage

```bash
nvm use            # Node 22
npm install
cp .env.example .env
npm run db:up         # Postgres + Redis (Docker)
npm run dev
```

Vérifications : `npm run build`, `npm run typecheck`, `npm run format:check`.

Base de données : Postgres sur le port **5433** et Redis sur **6380** (décalés pour ne pas entrer en conflit avec d'autres projets). Migrations : `npm run db:migrate -w @resto/api`.

## Prochaines étapes

Auth, catalogue, commandes, hors-ligne (IndexedDB + outbox idempotente).
