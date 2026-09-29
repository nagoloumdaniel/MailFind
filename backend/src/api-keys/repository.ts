import { getPool, query } from '../db/pool.js';
import { generateApiKey, type ApiScope } from './keys.js';

/**
 * Au-dela, une cle de plus n'a pas d'usage legitime : une par application
 * suffit, et chaque cle active est une porte de plus a surveiller.
 */
export const MAX_ACTIVE_KEYS = 10;

/**
 * La date de derniere utilisation n'a pas besoin d'etre exacte a la seconde :
 * l'ecrire au plus une fois par minute evite une ecriture en base par requete.
 */
const RAFRAICHISSEMENT_SECONDES = 60;

/** Ce que la page Compte montre d'une cle : jamais le secret, jamais l'empreinte. */
export interface ApiKeySummary {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: readonly ApiScope[];
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  last_used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

const COLONNES = 'id, name, prefix, scopes, last_used_at, revoked_at, created_at';

function versResume(ligne: ApiKeyRow): ApiKeySummary {
  return {
    id: ligne.id,
    name: ligne.name,
    prefix: ligne.prefix,
    scopes: ligne.scopes,
    lastUsedAt: ligne.last_used_at,
    revokedAt: ligne.revoked_at,
    createdAt: ligne.created_at,
  };
}

export type CreateApiKeyResult =
  | { readonly kind: 'created'; readonly key: ApiKeySummary; readonly secret: string }
  | { readonly kind: 'limit_reached' };

export async function createApiKey(
  userId: string,
  name: string,
  scopes: readonly ApiScope[],
): Promise<CreateApiKeyResult> {
  const cle = generateApiKey();
  const client = await getPool().connect();
  try {
    await client.query('begin');
    // Un verrou par compte, le temps de compter puis d'inserer : sans lui,
    // deux creations simultanees verraient chacune la derniere place libre.
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`api_keys:${userId}`]);
    const cree = await client.query<ApiKeyRow>(
      `insert into api_keys (user_id, name, prefix, key_hash, scopes)
       select $1, $2, $3, $4, $5::text[]
        where (select count(*) from api_keys
                where user_id = $1 and revoked_at is null) < $6
       returning ${COLONNES}`,
      [userId, name, cle.prefix, cle.hash, [...new Set(scopes)], MAX_ACTIVE_KEYS],
    );
    await client.query('commit');
    const ligne = cree.rows[0];
    if (ligne === undefined) return { kind: 'limit_reached' };
    return { kind: 'created', key: versResume(ligne), secret: cle.secret };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Les cles du compte, les plus recentes d'abord, revoquees comprises. */
export async function listApiKeys(userId: string): Promise<ApiKeySummary[]> {
  const lignes = await query<ApiKeyRow>(
    `select ${COLONNES} from api_keys where user_id = $1 order by created_at desc, id desc`,
    [userId],
  );
  return lignes.rows.map(versResume);
}

/** Revoque une cle du compte ; rend null si elle n'existe pas ou l'etait deja. */
export async function revokeApiKey(userId: string, keyId: string): Promise<ApiKeySummary | null> {
  const lignes = await query<ApiKeyRow>(
    `update api_keys set revoked_at = now()
      where id = $1 and user_id = $2 and revoked_at is null
      returning ${COLONNES}`,
    [keyId, userId],
  );
  const ligne = lignes.rows[0];
  return ligne === undefined ? null : versResume(ligne);
}

export interface ActiveApiKey {
  readonly id: string;
  readonly userId: string;
  readonly scopes: readonly ApiScope[];
}

/**
 * La cle active qui porte cette empreinte, sur un compte qui existe encore.
 * La recherche se fait sur l'empreinte exacte, indexee : aucune comparaison
 * de secret ne depend de sa valeur.
 */
export async function findActiveApiKey(hash: string): Promise<ActiveApiKey | undefined> {
  const lignes = await query<{ id: string; user_id: string; scopes: ApiScope[] }>(
    `select k.id, k.user_id, k.scopes
       from api_keys k
       join users u on u.id = k.user_id and u.deleted_at is null
      where k.key_hash = $1 and k.revoked_at is null`,
    [hash],
  );
  const ligne = lignes.rows[0];
  return ligne === undefined
    ? undefined
    : { id: ligne.id, userId: ligne.user_id, scopes: ligne.scopes };
}

export async function touchApiKey(keyId: string): Promise<void> {
  await query(
    `update api_keys set last_used_at = now()
      where id = $1
        and (last_used_at is null
             or last_used_at < now() - make_interval(secs => $2))`,
    [keyId, RAFRAICHISSEMENT_SECONDES],
  );
}
