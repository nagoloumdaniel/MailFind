import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { getEnvironment } from '../config/env.js';
import { checksum, collectMigrations, type Migration } from './migrations.js';

/**
 * Applique les migrations SQL versionnees, avec retour arriere (D-04).
 *
 *   npm run migrate -- status
 *   npm run migrate -- up
 *   npm run migrate -- down
 *
 * Toujours par l'hote direct : un pgbouncer ne sait tenir ni le verrou
 * consultatif qui empeche deux deploiements de migrer en meme temps, ni un
 * ordre DDL dans une transaction longue.
 */

const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../../migrations/', import.meta.url));

// Entier arbitraire mais stable : deux processus qui migrent la meme base
// doivent demander exactement le meme verrou.
const ADVISORY_LOCK_KEY = 4_413_071;

interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

async function readMigrations(): Promise<Migration[]> {
  return collectMigrations(await readdir(MIGRATIONS_DIRECTORY));
}

async function readSql(file: string): Promise<string> {
  return readFile(join(MIGRATIONS_DIRECTORY, file), 'utf8');
}

async function ensureRegistry(client: pg.Client): Promise<void> {
  await client.query(`
    create table if not exists schema_migrations (
      version    integer primary key,
      name       text        not null,
      checksum   text        not null,
      applied_at timestamptz not null default now()
    )
  `);
}

async function readApplied(client: pg.Client): Promise<AppliedMigration[]> {
  const result = await client.query<AppliedMigration>(
    'select version, name, checksum from schema_migrations order by version',
  );
  return result.rows;
}

/**
 * Une migration deja jouee dont le fichier a change ne sera jamais rejouee :
 * deux bases se croiraient identiques en portant des schemas differents. Mieux
 * vaut le dire tout de suite que le decouvrir en production.
 */
function assertUnchanged(
  migrations: Migration[],
  applied: AppliedMigration[],
  sql: Map<number, string>,
): void {
  for (const record of applied) {
    const migration = migrations.find((candidate) => candidate.version === record.version);
    if (migration === undefined) {
      throw new Error(
        `La migration ${String(record.version).padStart(4, '0')}_${record.name} est appliquee ` +
          `en base mais absente du depot.`,
      );
    }
    const current = sql.get(record.version);
    if (current !== undefined && checksum(current) !== record.checksum) {
      throw new Error(
        `Le fichier de la migration ${migration.upFile} a change apres son application. ` +
          `Ecrire une nouvelle migration plutot que de modifier celle-ci.`,
      );
    }
  }
}

type Command = 'up' | 'down' | 'status';

function parseCommand(argument: string | undefined): Command {
  if (argument === undefined || argument === 'status') return 'status';
  if (argument === 'up' || argument === 'down') return argument;
  throw new Error(`Commande inconnue : ${argument}. Attendu : up, down ou status.`);
}

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Les variables peuvent venir de l'hebergeur.
  }

  const command = parseCommand(process.argv[2]);
  const environment = getEnvironment();
  const migrations = await readMigrations();

  const sql = new Map<number, string>();
  for (const migration of migrations) {
    sql.set(migration.version, await readSql(migration.upFile));
  }

  const client = new pg.Client({
    connectionString: environment.DIRECT_DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });
  await client.connect();

  try {
    await client.query('select pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await ensureRegistry(client);

    const applied = await readApplied(client);
    assertUnchanged(migrations, applied, sql);

    const appliedVersions = new Set(applied.map((record) => record.version));

    if (command === 'status') {
      for (const migration of migrations) {
        const state = appliedVersions.has(migration.version) ? 'appliquee' : 'en attente';
        write(`${String(migration.version).padStart(4, '0')}  ${state}  ${migration.name}`);
      }
      if (migrations.length === 0) write('Aucune migration.');
      return;
    }

    if (command === 'up') {
      const pending = migrations.filter((migration) => !appliedVersions.has(migration.version));
      if (pending.length === 0) {
        write('Rien a appliquer.');
        return;
      }

      for (const migration of pending) {
        const content = sql.get(migration.version) ?? '';
        await client.query('begin');
        try {
          await client.query(content);
          await client.query(
            'insert into schema_migrations (version, name, checksum) values ($1, $2, $3)',
            [migration.version, migration.name, checksum(content)],
          );
          await client.query('commit');
          write(`applique  ${migration.upFile}`);
        } catch (error) {
          await client.query('rollback');
          throw error;
        }
      }
      return;
    }

    // down : une seule migration a la fois. Annuler tout un historique d'un
    // coup est une operation trop lourde pour etre declenchee par une faute de
    // frappe.
    const last = applied.at(-1);
    if (last === undefined) {
      write('Rien a annuler.');
      return;
    }

    const migration = migrations.find((candidate) => candidate.version === last.version);
    if (migration === undefined) {
      throw new Error(`Le retour arriere de la migration ${last.name} est introuvable.`);
    }

    const content = await readSql(migration.downFile);
    await client.query('begin');
    try {
      await client.query(content);
      await client.query('delete from schema_migrations where version = $1', [migration.version]);
      await client.query('commit');
      write(`annule    ${migration.downFile}`);
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  } finally {
    await client.query('select pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}

await main();
