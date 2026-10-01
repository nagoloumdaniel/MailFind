import { query } from '../db/pool.js';
import { EncryptionError, keyIdOf, type Cipher } from './crypto.js';

/**
 * Rotation de la cle de chiffrement (S-01) : reecrit avec la cle courante
 * tout ce que l'ancienne a chiffre. Une fois le rapport sans valeur illisible,
 * ENCRYPTION_KEY_PREVIOUS peut etre retiree sans rien perdre.
 *
 * Chaque mise a jour ne passe que si la valeur n'a pas change depuis sa
 * lecture : un secret reecrit pendant la rotation n'est jamais ecrase par
 * l'ancien.
 */
export interface RotationReport {
  /** Valeurs reecrites avec la cle courante, par table. */
  readonly rewritten: Record<string, number>;
  /** Entrees de cache illisibles, supprimees : on repaiera plutot que de les garder. */
  readonly droppedCache: number;
  /** Secrets illisibles avec les cles configurees, laisses en place. */
  readonly unreadable: Record<string, number>;
}

interface Colonne {
  readonly table: string;
  readonly cle: string;
  readonly colonne: string;
}

// Les secrets que l'application doit relire. Une table de plus, une ligne de
// plus ici : le test d'integration echoue s'il en manque une.
export const ENCRYPTED_COLUMNS: readonly Colonne[] = [
  { table: 'webhooks', cle: 'id', colonne: 'secret_encrypted' },
  { table: 'campaign_mailer_connections', cle: 'user_id', colonne: 'token_encrypted' },
];

export async function rotateEncryption(cipher: Cipher): Promise<RotationReport> {
  const courante = keyIdOf(cipher.encrypt('rotation'));
  if (courante === undefined) throw new EncryptionError('Cle courante illisible.');

  const rewritten: Record<string, number> = {};
  const unreadable: Record<string, number> = {};

  for (const { table, cle, colonne } of ENCRYPTED_COLUMNS) {
    // Noms de tables et de colonnes tires de la liste ci-dessus, jamais d'une
    // entree exterieure.
    const lignes = await query<{ id: string; chiffre: string }>(
      `select ${cle}::text as id, ${colonne} as chiffre from ${table}
        where split_part(${colonne}, '.', 2) <> $1`,
      [courante],
    );
    rewritten[table] = 0;
    unreadable[table] = 0;
    for (const ligne of lignes.rows) {
      let clair: string;
      try {
        clair = cipher.decrypt(ligne.chiffre);
      } catch {
        unreadable[table] += 1;
        continue;
      }
      const maj = await query(
        `update ${table} set ${colonne} = $1 where ${cle}::text = $2 and ${colonne} = $3`,
        [cipher.encrypt(clair), ligne.id, ligne.chiffre],
      );
      rewritten[table] += maj.rowCount ?? 0;
    }
  }

  const caches = await query<{ provider: string; operation: string; key: string; chiffre: string }>(
    `select provider, operation, key, response->>'chiffre' as chiffre from provider_cache
      where response ? 'chiffre' and split_part(response->>'chiffre', '.', 2) <> $1`,
    [courante],
  );
  rewritten.provider_cache = 0;
  let droppedCache = 0;
  for (const ligne of caches.rows) {
    const ou = [ligne.provider, ligne.operation, ligne.key, ligne.chiffre];
    try {
      const nouveau = cipher.encrypt(cipher.decrypt(ligne.chiffre));
      const maj = await query(
        `update provider_cache set response = jsonb_build_object('chiffre', $5::text)
          where provider = $1 and operation = $2 and key = $3 and response->>'chiffre' = $4`,
        [...ou, nouveau],
      );
      rewritten.provider_cache += maj.rowCount ?? 0;
    } catch {
      const sup = await query(
        `delete from provider_cache
          where provider = $1 and operation = $2 and key = $3 and response->>'chiffre' = $4`,
        ou,
      );
      droppedCache += sup.rowCount ?? 0;
    }
  }

  return { rewritten, droppedCache, unreadable };
}
