import { createHash } from 'node:crypto';
import { getPool, query } from '../db/pool.js';
import { normalizeAddress } from '../verification/local.js';

/**
 * Liste de suppression (R-04, niveau 7 de 6.7) : les adresses qu'un
 * utilisateur ne veut plus jamais voir collectees ni transmises.
 *
 * Seule l'empreinte de l'adresse normalisee est gardee. La liste sert a
 * reconnaitre une adresse deja connue, jamais a la relire : elle ne doit pas
 * devenir elle-meme une liste d'adresses.
 */

export function hashAddress(normalized: string): string {
  return createHash('sha256').update(normalized.toLowerCase()).digest('hex');
}

export async function loadSuppressedHashes(userId: string): Promise<Set<string>> {
  const lues = await query<{ address_hash: string }>(
    'select address_hash from suppressions where user_id = $1',
    [userId],
  );
  return new Set(lues.rows.map((ligne) => ligne.address_hash));
}

/** Vrai quand l'adresse, une fois normalisee, figure dans la liste. */
export function isSuppressed(hashes: ReadonlySet<string>, address: string): boolean {
  if (hashes.size === 0) return false;
  const normalisee = normalizeAddress(address) ?? address.toLowerCase();
  return hashes.has(hashAddress(normalisee));
}

export interface SuppressionResult {
  readonly added: number;
  readonly alreadyListed: number;
  readonly invalid: number;
  /** Adresses de la bibliotheque passees « supprimees » par cet ajout. */
  readonly libraryUpdated: number;
}

/**
 * Ajoute des adresses a la liste, et fait passer « supprimees » celles que la
 * bibliotheque contient deja : score a zero, exclues, dans la meme
 * transaction. Une adresse supprimee ne peut pas rester exportable une seconde.
 */
export async function addSuppressions(
  userId: string,
  addresses: readonly string[],
  reason: string | undefined,
): Promise<SuppressionResult> {
  const normalisees = new Set<string>();
  let invalid = 0;
  for (const adresse of addresses) {
    const normalisee = normalizeAddress(adresse);
    if (normalisee === undefined) invalid += 1;
    else normalisees.add(normalisee);
  }
  const empreintes = [...normalisees].map(hashAddress);
  if (empreintes.length === 0) return { added: 0, alreadyListed: 0, invalid, libraryUpdated: 0 };

  const client = await getPool().connect();
  try {
    await client.query('begin');
    const ajoutees = await client.query(
      `insert into suppressions (user_id, address_hash, reason)
       select $1, unnest($2::text[]), $3
       on conflict on constraint suppressions_unique do nothing`,
      [userId, empreintes, reason ?? null],
    );
    const bibliotheque = await client.query(
      `update emails
          set status = 'suppressed', score = 0, excluded = true,
              excluded_reason = 'Adresse dans votre liste de suppression.',
              score_breakdown = jsonb_build_object(
                'score', 0,
                'criteria', jsonb_build_array(jsonb_build_object(
                  'criterion', 'suppressed', 'effect', 'score a 0', 'applied', true))),
              updated_at = now()
        where user_id = $1
          and encode(sha256(convert_to(normalized_address, 'UTF8')), 'hex') = any($2::text[])
          and status <> 'suppressed'`,
      [userId, empreintes],
    );
    await client.query('commit');
    const added = ajoutees.rowCount ?? 0;
    return {
      added,
      alreadyListed: empreintes.length - added,
      invalid,
      libraryUpdated: bibliotheque.rowCount ?? 0,
    };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function countSuppressions(userId: string): Promise<number> {
  const result = await query<{ n: number }>(
    'select count(*)::int as n from suppressions where user_id = $1',
    [userId],
  );
  return result.rows[0]?.n ?? 0;
}

/** Retire une adresse de la liste, a la demande de l'utilisateur lui-meme. */
export async function removeSuppression(userId: string, address: string): Promise<boolean> {
  const normalisee = normalizeAddress(address);
  if (normalisee === undefined) return false;
  const result = await query('delete from suppressions where user_id = $1 and address_hash = $2', [
    userId,
    hashAddress(normalisee),
  ]);
  return (result.rowCount ?? 0) > 0;
}
