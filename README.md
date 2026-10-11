# resto-platform

Monorepo pnpm + Turborepo.

| Chemin            | Rôle                                                              | Port |
| ----------------- | ----------------------------------------------------------------- | ---- |
| `apps/api`        | API NestJS                                                        | 4000 |
| `apps/backoffice` | Back-office restaurant (Next.js, PWA à venir)                     | 3000 |
| `apps/storefront` | Vitrine client (Next.js)                                          | 3001 |
| `packages/shared` | Types, règles métier (machine à états des commandes), utilitaires | -    |

## Démarrage

```bash
nvm use            # Node 22
pnpm install
cp .env.example .env
pnpm db:up         # Postgres + Redis (Docker)
pnpm dev
```

Vérifications : `pnpm build`, `pnpm typecheck`, `pnpm format:check`.

## Prochaines étapes

Modèle de données (Prisma/Drizzle), auth, commandes, hors-ligne (IndexedDB + outbox idempotente).
