# CLAUDE.md — resto-platform

Plateforme pour restaurants au **Cameroun** : une vitrine client (réservation + commande à emporter) et un back-office pour les opérations internes. Répondre à l'utilisateur **en français**.

## Produits

| App                    | Rôle                                                                                                             | Techno                       | Port |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---- |
| `apps/api`             | API unique, source de vérité                                                                                     | NestJS 12 (ESM), Prisma 7.10 | 4000 |
| `apps/backoffice`      | Opérations restaurant : prise de commande, cuisine, caisse, réservations, menu, rôles. PWA hors-ligne (à faire)  | Next.js 16                   | 3000 |
| `apps/storefront`      | Vitrine client : annuaire, menu, commande à emporter, réservation, suivi                                         | Next.js 16 (SEO)             | 3001 |
| `packages/shared`      | Types, machine à états des commandes, schémas Zod (auth), client API, utilitaires (`formatXAF`)                  | TypeScript                   | -    |
| `packages/ui`          | Composants shadcn/ui, thème Tailwind, i18n FR/EN, toasts, formulaires d'authentification partagés des deux sites | React, Tailwind 4            | -    |
| `packages/e2e-support` | Configuration Playwright commune, données de test uniques, assistants d'API                                      | Playwright                   | -    |

Mobile (React Native / Expo, Android puis iOS) viendra **après** les sites, avec le même client API et `@resto/shared`. Ancien prototype mobile de référence fonctionnelle : `~/projets/orders-app` (Expo, sync TCP locale, mots de passe en clair — ne pas le reprendre techniquement).

## Commandes

```bash
npm install
npm run db:up                      # Postgres :5433, Redis :6380 (Docker)
npm run dev                        # tous les workspaces via Turborepo
npm run build | typecheck | lint | format:check
npm test                           # tests unitaires de tous les workspaces
npm run test:e2e                   # tests fonctionnels (API + Playwright des deux sites)
npm run precommit                  # ce que fait le hook Husky (sans Playwright)
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

## Authentification (en place)

Deux espaces, une seule table `User` : `/auth/staff/*` (back-office) et `/auth/customer/*` (vitrine). Jetons d'accès JWT de 15 min d'**audience** `staff` ou `customer` (un jeton client n'ouvre jamais le back-office) ; refresh token à rotation (famille révoquée en cas de rejeu) dans un cookie httpOnly `resto_<espace>_rt` pour le web, dans le corps avec `x-client: native` pour le mobile. Les rôles viennent de `Membership` et sont **relus en base à chaque requête** (garde `@RestaurantRoles`) ; un non-membre reçoit la même 404 qu'un restaurant inexistant.

- **Méthodes** : téléphone camerounais (+237, 9 chiffres commençant par 6) + **PIN à 6 chiffres** (Argon2id + pepper) ; email + mot de passe (inscription en deux temps : le compte n'existe qu'après le code reçu par email) ; Google (ID token vérifié par l'API, rattachement seulement si l'email est vérifié des deux côtés).
- **Récupération sans SMS** : code de secours (affiché une fois), date de naissance + réponses secrètes (client : immédiat puis compte restreint 48 h ; compte ayant un rôle : demande **différée** 24 h/48 h, annulable par le titulaire, un gérant, ou en se connectant avec l'ancien PIN), code reçu par email. Toutes les erreurs de récupération sont génériques (pas d'énumération de comptes).
- **Anti-abus** : ralentissement progressif (table `AuthAttempt`) par compte et par IP, jamais de verrouillage dur ; comptes d'employés créés avec un **PIN temporaire** (claim JWT `mc` : toute route est refusée avec 403 tant qu'il n'est pas remplacé).
- Le numéro n'est **pas vérifié** (pas de SMS) : `phoneVerifiedAt` reste null tant que le restaurant n'a pas rappelé le client ; après immatriculation, ajouter l'OTP sans migration (`PhoneVerifiedMethod.OTP`).
- Variables : `AUTH_JWT_SECRET`, `AUTH_PEPPER` (≥ 32 caractères, obligatoires), `WEB_ORIGINS`, `TRUST_PROXY`, `SMTP_URL`/`MAIL_FROM` (sans `SMTP_URL` : emails en console en dev, **désactivés** en production), `GOOGLE_CLIENT_ID` côté API et `NEXT_PUBLIC_GOOGLE_CLIENT_ID` côté sites. Seed de démo : `npm run db:seed -w @resto/api` (PIN `483920`, interdit en production).
- Pas encore enforcé : le mode « compte restreint » (champ `User.restrictedUntil`, exposé en `restricted`) doit limiter les commandes en attente quand les commandes existeront.

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

## Tests

| Quoi                                                   | Outil                                                                                         | Commande                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------- |
| `shared`, `backoffice`, `storefront` (unit/composants) | Vitest (+ Testing Library, jsdom pour les sites)                                              | `npm test -w @resto/<workspace>`        |
| `api` unitaire (tout mocké)                            | Vitest + SWC (décorateurs Nest)                                                               | `npm test -w @resto/api`                |
| `api` fonctionnel                                      | Vitest + supertest, vraie app Nest, base `resto_test`                                         | `npm run test:e2e -w @resto/api`        |
| `packages/ui` (composants, API simulée)                | Vitest + Testing Library (jsdom)                                                              | `npm test -w @resto/ui`                 |
| sites fonctionnel                                      | Playwright (projets `mobile` Pixel 5 puis `desktop`), **vraie API + vraie base `resto_test`** | `npm run test:e2e -w @resto/backoffice` |

- Vitest et non Jest pour l'API : elle est en ESM, où ts-jest est pénible. `unplugin-swc` fournit les métadonnées de décorateurs.
- Postgres doit tourner (`npm run db:up`). La base `resto_test` est créée, migrée et vidée automatiquement par `apps/api/scripts/reset-test-db.mjs`, qui **refuse** toute base dont le nom ne contient pas « test » : la base de dev n'est jamais touchée.
- Convention : `*.spec.ts(x)` à côté du code ; fonctionnels API dans `apps/api/test/*.e2e-spec.ts` ; Playwright dans `apps/<site>/e2e/*.spec.ts`.
- Playwright (config commune dans `packages/e2e-support`) : lance l'**API réelle** (`NODE_ENV=test`, port 4010, base `resto_test` remise à zéro) puis le site en **build de production** sur le port de dev + 10 (3010 / 3011, `distDir` `.next-e2e`). Chrome système par défaut ; en CI `PW_CHANNEL=chromium`. Sélecteurs : `getByRole` / `getByLabel`. Tests **indépendants** : chacun a sa propre IP (`X-Forwarded-For`, `TRUST_PROXY=1`), ses numéros et emails uniques ; les comptes se préparent par l'API (`api.ownerWithRestaurant()`…) et l'UI ne teste que l'écran visé. Les emails « envoyés » se lisent via `GET /__test/emails` (module chargé **uniquement** si `NODE_ENV=test`).
- Piège Vitest/jest-dom : les `vitest.setup.ts` enregistrent les matchers avec `expect.extend(matchers)` (et non `jest-dom/vitest`, qui importerait le Vitest de la racine selon le hoisting npm).
- Piège Vitest : `beforeEach(() => mock.mockReset())` renvoie la fonction mock, que Vitest appelle ensuite comme nettoyage ; utiliser des accolades.
- `@testing-library/jest-dom` reste en **6.x** (la 7 ne s'enregistre pas avec Vitest 2).

## Règles de travail (obligatoires)

### 0. Branche de travail : `dev`

Tout le travail (code, tests, doc) se fait dans la branche `dev`, jamais directement sur `main` (vérifier avec `git branch --show-current`). `main` ne reçoit que des fusions de `dev` déjà vertes.

### 1. Tout changement de code est consolidé par des tests

Dans le même commit que la modification :

- logique métier, service, schéma, utilitaire, composant → **test unitaire** ;
- route d'API, parcours utilisateur, flux entre services → **test fonctionnel** (`*.e2e-spec.ts`, Playwright) ;
- correction de bug → un **test de non-régression** qui échoue avant le correctif et passe après ;
- ne jamais supprimer ni affaiblir un test pour le faire passer : corriger le code ou rediscuter du comportement attendu.

Toute nouvelle route d'API a des tests d'**autorisation** (rôle `Membership` manquant, autre restaurant) ; un identifiant d'un autre restaurant ne doit jamais contourner le contrôle.

### 2. UI : mobile first, composants réutilisables, shadcn

- Responsive **mobile d'abord** (Android d'entrée de gamme), puis tablette et desktop, chacun ergonomique dans son contexte (nav latérale vs barre basse, tableau vs cartes…) : traité **et testé** (Playwright mobile + desktop). Skill `frontend-design:frontend-design` pour les choix de design ; vérification visuelle via claude-in-chrome.
- **shadcn/ui** pour tous les composants de base : ne jamais recréer un composant qui existe. Les fichiers générés vivent dans **`packages/ui/src/components/ui`** (partagés par les deux sites, ignorés par ESLint, ne pas les modifier à la main). Pour en ajouter : `cd packages/ui && npx shadcn@latest add <composant>` ; la CLI ajoute parfois un faux paquet `cn` et des versions trop récentes dans `package.json` : vérifier `git diff` (imports `@resto/ui/lib/utils`, TypeScript 6, Vitest 2, jest-dom 6).
- **Éléments réutilisables d'abord** : avant d'écrire un composant, un hook ou un utilitaire, chercher s'il existe déjà. Ce qui sert aux deux sites va dans un paquet : types, schémas Zod, client API → `packages/shared` ; composants React, i18n, toasts, formulaires → `packages/ui` (le routeur Next est **injecté** par les apps : le paquet n'importe pas `next`) ; ce qui est propre à un site va dans son `src/components/<domaine>/`, `src/lib/`. Pas de copier-coller entre `backoffice` et `storefront`.
- **Formulaires** : react-hook-form + `zodResolver` avec des schémas Zod **partagés avec l'API** (`@resto/shared`), `mode: 'onChange'`, `FormField`/`FormMessage` de shadcn.
- **Retour d'information** : toute action utilisateur annonce son résultat par un toast (`notify.success` / `notify.error` de `@resto/ui`, jamais `toast()` direct : règle ESLint), et tout échec d'envoi de formulaire passe par `handleSubmitError` (erreurs de validation de l'API sous les champs, autres erreurs en message général + toast). Tester : succès, erreur de validation, 500, réseau coupé.
- **Textes FR/EN** : `packages/ui/src/i18n/{fr,en}.ts` (même structure imposée par le type). Les erreurs de l'API et des schémas Zod sont des **clés** (`pin.weak`, `auth.invalidCredentials`…) traduites dans `errors` : un test échoue si une clé émise par l'API ou par un schéma partagé n'est pas traduite. Jamais de chaîne en dur dans un composant. La langue vient du cookie `locale`.

### 3. API : validation et modules

- Entrées validées par **Zod** (schémas dans `@resto/shared`), via un pipe Nest unique ; jamais d'entité Prisma renvoyée telle quelle (pas de `passwordHash`).
- Un module Nest par domaine : `src/modules/<nom>/{nom}.module.ts|controller.ts|service.ts`, importé dans `app.module.ts`. Imports relatifs en `.js` (ESM).
- Toute requête filtre par `restaurantId` ; un test fonctionnel prouve l'isolation entre deux restaurants.

### 4. Précommit avant chaque commit

Le hook Husky (`.husky/pre-commit`) enchaîne et bloque au moindre échec : **lint + Prettier** des fichiers indexés (lint-staged) → **typecheck** → **tests unitaires** → **tests fonctionnels API** (`npm run db:up` démarre Postgres/Redis, Docker doit tourner). Playwright n'est pas dans le hook (trop long) : il tourne dans le CI.

- Même contrôle à la main : `npm run precommit`.
- Si le précommit révèle un problème, **le corriger dans le code** avant de commiter (jamais `--no-verify`, jamais supprimer ou affaiblir la règle ou le test), puis relancer jusqu'au vert. Relire les fichiers que le hook a reformatés.

### 5. Fin de travail : précommit, commit, push, suivi du CI

À la fin de chaque travail : précommit vert → commit dans `dev` → `git push origin dev` → suivre le CI (`gh run list --branch dev`, `gh run watch`). En cas d'échec : `gh run view --log-failed`, corriger la cause, recommiter, repousser. Le travail n'est terminé que lorsque le CI de `dev` est vert.

#### CI (GitHub Actions, `.github/workflows`)

- `ci.yml` (push sur `dev`, PR vers `dev`/`main`) : jobs **en parallèle** — `quality` (lint, format, typecheck, build), `unit`, `e2e-api` (Postgres en service sur 5433), `e2e-front` (Playwright, matrice `backoffice` / `storefront`). Ne déploie rien.
- `main.yml` (push et PR sur `main`) : contrôles rapides seulement (lint, format, typecheck, build). Le déploiement VPS s'y ajoutera.
- Après `git pull` qui ajoute une migration : `npm run db:migrate -w @resto/api` (dev) ou `db:deploy`.

## Feuille de route

Fait : squelette monorepo, schéma Prisma + migration `init`, `/health` avec ping base, **authentification complète** (voir section dédiée : API, écrans des deux sites, tests unitaires/fonctionnels/Playwright, seed).
À faire, dans l'ordre :

1. CRUD catalogue (catégories, produits, tables) côté API + back-office.
2. Premier flux complet : serveur prend une commande → cuisine → caissier encaisse, **avec le hors-ligne dès cette itération**.
3. Vitrine : annuaire, menu, commande à emporter, suivi en direct.
4. Réservations (agenda partagé vitrine/back-office).
5. Apps mobiles, puis paiements/WhatsApp (après immatriculation), livraison, fidélité.

## Points à régler

- **Sécurité par ligne (RLS Postgres)** pour isoler les restaurants ; aujourd'hui l'isolation n'existe que dans le futur code applicatif.
- Rien en base n'impose qu'une table/un produit appartienne au même restaurant que sa commande : à vérifier dans l'API.
- Tests : l'authentification est couverte à tous les niveaux ; chaque nouvelle fonctionnalité doit apporter les siens (règle 1).
- Pas de Dockerfile/déploiement VPS (Docker Compose + Caddy/Nginx HTTPS à prévoir) ; le CI ne déploie rien.
- Pas de PWA/service worker ni de temps réel encore ; l'i18n couvre pour l'instant les écrans d'authentification, de restaurant et d'équipe.
- Authentification : une demande de récupération différée n'est pas notifiée hors de l'application (pas de SMS/WhatsApp) ; le titulaire ne la voit qu'à sa prochaine connexion ou via un gérant. À compléter après immatriculation.
- Marché : un « Uber Eats » demande du volume des deux côtés — commencer avec peu de restaurants, côté back-office d'abord (valeur sans clients).
