import { randomUUID } from 'node:crypto';
import { CURRENT_TERMS_VERSION } from '../../auth/routes.js';
import { query } from '../../db/pool.js';

/** Repart d'une base vide entre deux tests, sans rejouer les migrations. */
export async function resetData(): Promise<void> {
  await query('truncate users, audit_events, imports, import_rows, companies cascade');
}

/** Un compte qui a accepte les conditions en vigueur, donc qui peut importer. */
export async function createUser(): Promise<string> {
  const identifiant = randomUUID();
  const result = await query<{ id: string }>(
    `insert into users (google_id, email, name, terms_version, terms_accepted_at)
     values ($1, $2, 'Test', $3, now())
     returning id`,
    [identifiant, `${identifiant}@exemple.test`, CURRENT_TERMS_VERSION],
  );
  const ligne = result.rows[0];
  if (ligne === undefined) throw new Error("Le compte de test n'a pas ete cree.");
  return ligne.id;
}
