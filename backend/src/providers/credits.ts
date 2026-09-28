import { getPool, query } from '../db/pool.js';

/**
 * Credits des fournisseurs payants : reserver avant l'appel, regler apres
 * (section 8.4). Regle non negociable du depot : un appel paye est compte,
 * mis en cache et plafonne, et une tache rejouee ne paie jamais deux fois.
 *
 * La reservation porte une cle derivee de l'import, de l'entreprise et de
 * l'operation. Rejouer une tache retombe donc sur la meme ligne :
 *
 * - reglee, elle dit que l'appel est deja fait, et le resultat est au cache ;
 * - encore « reservee », l'appel a pu partir avant la coupure. On ne le
 *   refait pas : payer deux fois est pire que de ne pas savoir, et
 *   l'utilisateur peut toujours renseigner le domaine lui-meme.
 */

export interface CallScope {
  readonly provider: string;
  readonly operation: string;
  readonly userId: string;
  readonly importId?: string;
  readonly companyId?: string;
  readonly idempotencyKey: string;
  readonly credits?: number;
}

export interface CallLimits {
  /** Plafond mensuel par utilisateur (D-14). */
  readonly perUserMonthly: number;
  /** Plafond mensuel pour tout MailFind : les credits offerts (D-13). */
  readonly globalMonthly: number;
}

export type Reservation =
  | { readonly kind: 'reserved'; readonly id: string }
  | { readonly kind: 'already_settled'; readonly status: 'confirmed' | 'cached' | 'failed' }
  | { readonly kind: 'interrupted' }
  | { readonly kind: 'user_quota_reached' }
  | { readonly kind: 'global_quota_reached' };

/** Ce qui compte dans un plafond : ce qui a ete, ou a pu etre, paye. */
const CONSOMME = `status in ('reserved', 'confirmed')`;

export async function reserveCall(scope: CallScope, limits: CallLimits): Promise<Reservation> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    // Un verrou par fournisseur, le temps de compter puis d'inserer : sans
    // lui, deux processus verraient chacun une place libre et prendraient la
    // meme.
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`credits:${scope.provider}`]);

    const existante = await client.query<{ status: string }>(
      'select status::text as status from provider_calls where idempotency_key = $1',
      [scope.idempotencyKey],
    );
    const statut = existante.rows[0]?.status;
    if (statut !== undefined) {
      await client.query('commit');
      if (statut === 'reserved') return { kind: 'interrupted' };
      return { kind: 'already_settled', status: statut as 'confirmed' | 'cached' | 'failed' };
    }

    const comptes = await client.query<{ utilisateur: string; total: string }>(
      `select coalesce(sum(credits) filter (where user_id = $2), 0) as utilisateur,
              coalesce(sum(credits), 0) as total
         from provider_calls
        where provider = $1 and ${CONSOMME}
          and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'`,
      [scope.provider, scope.userId],
    );
    const credits = scope.credits ?? 1;
    const utilisateur = Number(comptes.rows[0]?.utilisateur ?? 0);
    const total = Number(comptes.rows[0]?.total ?? 0);

    if (total + credits > limits.globalMonthly) {
      await client.query('commit');
      return { kind: 'global_quota_reached' };
    }
    if (utilisateur + credits > limits.perUserMonthly) {
      await client.query('commit');
      return { kind: 'user_quota_reached' };
    }

    const cree = await client.query<{ id: string }>(
      `insert into provider_calls
         (user_id, import_id, company_id, provider, operation, idempotency_key, credits)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [
        scope.userId,
        scope.importId ?? null,
        scope.companyId ?? null,
        scope.provider,
        scope.operation,
        scope.idempotencyKey,
        credits,
      ],
    );
    await client.query('commit');
    return { kind: 'reserved', id: cree.rows[0]?.id ?? '' };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Regle une reservation : appel fait, repondu par le cache, ou echoue. */
export async function settleCall(
  id: string,
  issue: 'confirmed' | 'cached' | 'failed',
  error?: string,
): Promise<void> {
  // Un appel repondu par le cache ou refuse ne consomme rien.
  await query(
    `update provider_calls
        set status = $2::provider_call_status, settled_at = now(), error = $3,
            credits = case when $2::provider_call_status = 'confirmed' then credits else 0 end
      where id = $1 and status = 'reserved'`,
    [id, issue, error ?? null],
  );
}

export async function readCache<T>(
  provider: string,
  operation: string,
  key: string,
): Promise<T | undefined> {
  const result = await query<{ response: T }>(
    `select response from provider_cache
      where provider = $1 and operation = $2 and key = $3 and expires_at > now()`,
    [provider, operation, key],
  );
  return result.rows[0]?.response;
}

export async function writeCache(
  provider: string,
  operation: string,
  key: string,
  response: unknown,
  ttlDays: number,
): Promise<void> {
  await query(
    `insert into provider_cache (provider, operation, key, response, expires_at)
     values ($1, $2, $3, $4, now() + make_interval(days => $5))
     on conflict (provider, operation, key)
     do update set response = excluded.response, created_at = now(),
                   expires_at = excluded.expires_at`,
    [provider, operation, key, JSON.stringify(response), ttlDays],
  );
}
