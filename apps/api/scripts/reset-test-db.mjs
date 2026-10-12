/**
 * Prépare la base de test : applique les migrations (crée la base si besoin) puis vide les tables.
 * Garde-fou : refuse de tourner si le nom de la base ne contient pas « test ».
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function resetTestDb(url = process.env.DATABASE_URL) {
  const dbName = new URL(url ?? '').pathname.replace('/', '');
  if (!dbName.includes('test')) {
    throw new Error(`Refus de réinitialiser "${dbName}" : le nom de la base doit contenir "test".`);
  }

  // migrate deploy crée la base si elle n'existe pas, puis applique les migrations
  execSync('npx prisma migrate deploy', {
    cwd: root,
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  });

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`,
    );
    if (rows.length) {
      const list = rows.map((r) => `"${r.tablename}"`).join(', ');
      await client.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await client.end();
  }
}
