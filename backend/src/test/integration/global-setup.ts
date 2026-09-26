import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { collectMigrations } from '../../db/migrations.js';

/**
 * Prepare la base des tests d'integration, une fois pour toute la suite.
 *
 * Le schema est efface puis reconstruit par les vraies migrations, dans les
 * deux sens : montee, descente complete, montee. Une migration dont le retour
 * arriere oublie un type ou une table echoue ici, pas le jour ou il faudra
 * annuler un deploiement.
 */

const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../../../migrations/', import.meta.url));

/**
 * Effacer le schema d'une base de production serait irreparable. La base doit
 * donc porter « test » dans son nom : c'est une convention qui ne coute rien a
 * respecter, et qui rend l'accident impossible.
 */
export function assertTestDatabase(url: string): void {
  const nom = new URL(url).pathname.replace(/^\//, '');
  if (!nom.includes('test')) {
    throw new Error(
      `TEST_DATABASE_URL vise la base « ${nom} ». Les tests d'integration effacent le schema : ` +
        `ils ne tournent que sur une base dont le nom contient « test ».`,
    );
  }
}

export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (url === undefined || url === '') {
    throw new Error(
      'TEST_DATABASE_URL est vide. Les tests d integration ont besoin d un PostgreSQL 18, ' +
        'par exemple postgresql://test:test@localhost:5432/mailfind_test?sslmode=disable',
    );
  }
  assertTestDatabase(url);

  const migrations = collectMigrations(await readdir(MIGRATIONS_DIRECTORY));
  const lire = (fichier: string) => readFile(join(MIGRATIONS_DIRECTORY, fichier), 'utf8');

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('drop schema if exists public cascade');
    await client.query('create schema public');

    for (const migration of migrations) await client.query(await lire(migration.upFile));
    for (const migration of [...migrations].reverse()) {
      await client.query(await lire(migration.downFile));
    }
    for (const migration of migrations) await client.query(await lire(migration.upFile));
  } finally {
    await client.end();
  }
}
