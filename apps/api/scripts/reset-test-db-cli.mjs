/**
 * Prépare la base de test avant de lancer l'API pour les tests Playwright :
 * migre et vide `resto_test` (refuse toute base dont le nom ne contient pas « test »).
 */
import { resetTestDb } from './reset-test-db.mjs';

await resetTestDb(process.env.DATABASE_URL);
console.log('Base de test prête.');
