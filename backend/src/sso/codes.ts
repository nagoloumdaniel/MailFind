import { createHash, randomBytes } from 'node:crypto';
import { query } from '../db/pool.js';
import { findUserById, type User } from '../users/repository.js';

/** Une minute : le temps d'une redirection et d'un appel, pas davantage. */
const CODE_TTL_SECONDS = 60;

const empreinte = (code: string) => createHash('sha256').update(code).digest('hex');

/**
 * Emet un code de connexion pour Campaign Mailer (D-26). Le code n'existe en
 * clair que dans la redirection ; la base n'en garde que l'empreinte.
 */
export async function issueSsoCode(userId: string): Promise<string> {
  const code = randomBytes(32).toString('base64url');
  // Le menage des codes perimes se fait ici : la table reste minuscule sans
  // tache planifiee de plus.
  await query(`delete from sso_codes where expires_at < now() - interval '1 hour'`);
  await query(
    `insert into sso_codes (code_hash, user_id, expires_at)
     values ($1, $2, now() + make_interval(secs => $3))`,
    [empreinte(code), userId, CODE_TTL_SECONDS],
  );
  return code;
}

/**
 * Consomme un code : une seule fois, avant son expiration. Un update
 * conditionnel plutot qu'une lecture puis une ecriture, pour que deux
 * echanges simultanes du meme code ne reussissent jamais tous les deux.
 */
export async function consumeSsoCode(code: string): Promise<User | undefined> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) return undefined;
  const result = await query<{ user_id: string }>(
    `update sso_codes set used_at = now()
      where code_hash = $1 and used_at is null and expires_at > now()
      returning user_id`,
    [empreinte(code)],
  );
  const ligne = result.rows[0];
  return ligne === undefined ? undefined : findUserById(ligne.user_id);
}
