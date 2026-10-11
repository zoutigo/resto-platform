# CLAUDE.md — resto-platform

Plateforme pour restaurants au **Cameroun** : une vitrine client (réservation + commande à emporter) et un back-office pour les opérations internes. Répondre à l'utilisateur **en français**.

## Produits

| App               | Rôle                                                                                                            | Techno                       | Port |
| ----------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---- |
| `apps/api`        | API unique, source de vérité                                                                                    | NestJS 12 (ESM), Prisma 7.10 | 4000 |
| `apps/backoffice` | Opérations restaurant : prise de commande, cuisine, caisse, réservations, menu, rôles. PWA hors-ligne (à faire) | Next.js 16                   | 3000 |
| `apps/storefront` | Vitrine client : annuaire, menu, commande à emporter, réservation, suivi                                        | Next.js 16 (SEO)             | 3001 |
| `packages/shared` | Types, machine à états des commandes, utilitaires (`formatXAF`)                                                 | TypeScript                   | -    |

Mobile (React Native / Expo, Android puis iOS) viendra **après** les sites, avec le même client API et `@resto/shared`. Ancien prototype mobile de référence fonctionnelle : `~/projets/orders-app` (Expo, sync TCP locale, mots de passe en clair — ne pas le reprendre techniquement).

## Commandes

```bash
npm install
npm run db:up                      # Postgres :5433, Redis :6380 (Docker)
npm run dev                        # tous les workspaces via Turborepo
npm run build | typecheck | format:check
npm run db:migrate -w @resto/api   # migrations Prisma
```

Les ports Docker sont **5433/6380** car 5432/6379 sont pris par un autre projet de l'utilisateur : ne jamais arrêter ses conteneurs.

## Conventions et pièges

- **npm** uniquement (workspaces + Turborepo). Ne pas réintroduire pnpm/yarn.
- **TypeScript 6** fixé : TS 7 casse la CLI Nest (pas d'API programmatique). Ne pas monter tant que Nest ne le supporte pas.
- **Prisma 7.10.0 fixé** (`latest` sur npm est une 8.0 RC avec une CLI différente). Client généré dans `apps/api/src/generated/` (ignoré par git, régénéré par `build`/`dev`/`typecheck`). Config dans `apps/api/prisma.config.ts`.
- L'API est en **ESM** : les imports relatifs prennent l'extension `.js`.
- Prix en **XAF**, entiers. Fuseau `Africa/Douala`. i18n FR/EN prévue dès le début.
- Identifiants **UUIDv7** générables côté client (création hors-ligne).
- Statuts de commande en anglais : `DRAFT → PENDING_PREP → IN_PREP → PARTIALLY_READY → READY → PARTIALLY_SERVED → SERVED` (+ `CANCELLED`). Règle dans `packages/shared/src/order-status.ts`, à utiliser côté API et clients.
- Commits : Prettier (`npm run format`) avant de commiter.

## Décisions d'architecture

- Monolithe modulaire NestJS, multi-tenant : une base, `restaurantId` partout.
- Le **serveur est la source de vérité** ; le hors-ligne est une tolérance aux coupures (réseau, électricité), pas un mode nominal.
- Abstractions `PaymentProvider` et `NotificationChannel` dès le départ : en v1 seulement « cash » et « in-app ».

## Contraintes métier (société non immatriculée)

Tant que la société n'est pas immatriculée :

- **Pas de paiement en ligne** (MTN MoMo, Orange Money via agrégateur : CamPay, Notch Pay, Flutterwave, Monetbil — à comparer plus tard). Commande à emporter = **paiement au retrait** (espèces/mobile money au comptoir).
- **Pas de WhatsApp ni SMS** (donc pas d'OTP téléphone). Notifications v1 : temps réel dans l'app (WebSocket/SSE), Web Push, éventuellement email.
- Connexion client : email + mot de passe ou Google ; téléphone = simple contact.
- Anti-abus des commandes non retirées : confirmation par le restaurant, plafond de commandes en attente, acompte plus tard.

## Hors-ligne (design retenu pour le back-office)

1. Service Worker (Serwist/Workbox) : l'app shell s'ouvre sans réseau.
2. IndexedDB (Dexie) : menu, tables, utilisateurs, commandes ouvertes ; les écrans lisent d'abord en local.
3. **Outbox** d'actions `{id: uuid, type, payload, createdAt, deviceId}` appliquées localement tout de suite, rejouées dans l'ordre via `POST /sync` (lot d'actions **idempotentes** ; table `SyncAction`).
4. Resynchronisation descendante par curseur (`updatedAt`/version) + WebSocket.

- Conflits : ids client (UUIDv7) ; `Order.number` (#108) attribué **par le serveur** à la synchro (provisoire hors-ligne) ; les statuts n'avancent que vers l'avant (le plus avancé gagne) ; lignes de commande = événements ajout/retrait, pas de tableau remplacé ; autres conflits : le serveur gagne + message.
- Pas hors-ligne : comptes, rôles, prix, commandes en ligne entrantes, rapports/clôtures.
- UI : indicateur permanent « En ligne / Hors ligne – N actions en attente / Synchronisation… ».
- Mobile plus tard : expo-sqlite à la place d'IndexedDB, même contrat `/sync`.

## Spécificités Cameroun

Android d'entrée de gamme, data chère : pages légères, images WebP redimensionnées. Pas d'adresses fiables : retrait sur place et réservation d'abord, livraison plus tard (repères + GPS). Coupures d'électricité : reprise sans perte de commande. Hébergement : VPS (région Europe + CDN), sauvegardes `pg_dump` chiffrées vers stockage externe dès le premier jour.

## Feuille de route

Fait : squelette monorepo, schéma Prisma + migration `init`, `/health` avec ping base.
À faire, dans l'ordre :

1. **Auth** : inscription/connexion (email + Argon2), JWT access + refresh, gardes par rôle selon `Membership`, seed d'un restaurant de démo.
2. CRUD catalogue (catégories, produits, tables) côté API + back-office.
3. Premier flux complet : serveur prend une commande → cuisine → caissier encaisse, **avec le hors-ligne dès cette itération**.
4. Vitrine : annuaire, menu, commande à emporter, suivi en direct.
5. Réservations (agenda partagé vitrine/back-office).
6. Apps mobiles, puis paiements/WhatsApp (après immatriculation), livraison, fidélité.

## Points à régler

- **Sécurité par ligne (RLS Postgres)** pour isoler les restaurants ; aujourd'hui l'isolation n'existe que dans le futur code applicatif.
- Rien en base n'impose qu'une table/un produit appartienne au même restaurant que sa commande : à vérifier dans l'API.
- Lint des apps Next = placeholder (configurer ESLint) ; aucun test écrit (seulement des scripts `echo`).
- Pas de seed, pas de Dockerfile/déploiement VPS (Docker Compose + Caddy/Nginx HTTPS à prévoir), pas de CI.
- Pas d'i18n, pas de PWA/service worker, pas de temps réel encore.
- Marché : un « Uber Eats » demande du volume des deux côtés — commencer avec peu de restaurants, côté back-office d'abord (valeur sans clients).
