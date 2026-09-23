import pg from 'pg';
import { getEnvironment } from '../config/env.js';

/**
 * Reserve de connexions de l'application, sur l'hote groupe de Neon.
 *
 * La taille reste basse a dessein : pgbouncer multiplexe deja cote Neon, et
 * plusieurs processus de traitement viendront s'ajouter a l'API. Ouvrir large
 * ici ne gagne rien et consomme le quota de connexions du projet.
 */
let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({
    connectionString: getEnvironment().DATABASE_URL,
    // Verification complete de la chaine de certificats, pas seulement du
    // chiffrement.
    ssl: { rejectUnauthorized: true },
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return pool;
}

export async function query<Row extends pg.QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<pg.QueryResult<Row>> {
  return getPool().query<Row>(text, [...values]);
}

/** Ferme la reserve. Appelee a l'arret du processus, et par les tests. */
export async function closePool(): Promise<void> {
  if (pool === undefined) return;
  const closing = pool;
  pool = undefined;
  await closing.end();
}
