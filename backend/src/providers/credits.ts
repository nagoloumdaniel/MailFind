import { getPool, query } from '../db/pool.js';
import { EncryptionError, type Cipher } from '../security/crypto.js';
import { alertBudgetReached, spendPolicy, type SpendPolicy } from './budget.js';

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

/**
 * Plafonds d'une operation d'un fournisseur. Ils se comptent par operation,
 * pas par fournisseur : D-14 partage les 50 credits mensuels de Hunter entre
 * la recherche (30) et la verification (20), et l'une ne doit pas manger
 * l'autre.
 */
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
  | { readonly kind: 'global_quota_reached' }
  | { readonly kind: 'budget_reached' };

/** Ce qui compte dans un plafond : ce qui a ete, ou a pu etre, paye. */
const CONSOMME = `status in ('reserved', 'confirmed')`;

/**
 * Note l'atteinte du plafond, et dit si c'est la premiere du mois pour ce
 * fournisseur : seule la premiere alerte.
 */
async function insertBudgetAlert(
  provider: string,
  spentCents: number,
  budget: number,
): Promise<boolean> {
  const issue = await query(
    `insert into provider_budget_alerts (provider, period, spent_cents, budget_cents)
     values ($1, date_trunc('month', now() at time zone 'utc')::date, $2, $3)
     on conflict (provider, period) do nothing`,
    [provider, spentCents, budget],
  );
  return (issue.rowCount ?? 0) > 0;
}

export async function reserveCall(
  scope: CallScope,
  limits: CallLimits,
  /** La politique de depense ; celle de la configuration par defaut (F-1405). */
  spend?: SpendPolicy,
): Promise<Reservation> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    // Un verrou par fournisseur, le temps de compter puis d'inserer : sans
    // lui, deux processus verraient chacun une place libre et prendraient la
    // meme.
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [
      `credits:${scope.provider}:${scope.operation}`,
    ]);

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
        where provider = $1 and operation = $3 and ${CONSOMME}
          and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'`,
      [scope.provider, scope.userId, scope.operation],
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

    // La depense se compte par fournisseur, toutes operations confondues :
    // c'est une facture, pas un compteur d'appels (F-1405).
    const { costCents: cout, budgetCents: budget } = spend ?? spendPolicy(scope.provider, credits);
    if (cout > 0) {
      const depense = await client.query<{ total: string }>(
        `select coalesce(sum(cost_cents), 0) as total from provider_calls
          where provider = $1 and ${CONSOMME}
            and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'`,
        [scope.provider],
      );
      const deja = Number(depense.rows[0]?.total ?? 0);
      if (deja + cout > budget) {
        await client.query('commit');
        // Hors de la transaction de reservation : l'alerte ne doit pas
        // pouvoir annuler un refus, ni le refus perdre l'alerte.
        await alertBudgetReached(insertBudgetAlert, scope.provider, deja, budget);
        return { kind: 'budget_reached' };
      }
    }

    const cree = await client.query<{ id: string }>(
      `insert into provider_calls
         (user_id, import_id, company_id, provider, operation, idempotency_key, credits, cost_cents)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id`,
      [
        scope.userId,
        scope.importId ?? null,
        scope.companyId ?? null,
        scope.provider,
        scope.operation,
        scope.idempotencyKey,
        credits,
        cout,
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
  options: { readonly free?: boolean } = {},
): Promise<void> {
  // Un appel repondu par le cache ou refuse ne consomme rien, ni un appel
  // fait que le fournisseur n'a pas facture : il reste « confirme », pour
  // qu'un rejeu ne le refasse pas.
  await query(
    `update provider_calls
        set status = $2::provider_call_status, settled_at = now(), error = $3,
            credits = case when $2::provider_call_status = 'confirmed' and not $4
                           then credits else 0 end,
            -- Le cout suit les credits : un appel que le fournisseur n'a pas
            -- facture ne doit pas peser sur le budget du mois (F-1405).
            cost_cents = case when $2::provider_call_status = 'confirmed' and not $4
                              then cost_cents else 0 end
      where id = $1 and status = 'reserved'`,
    [id, issue, error ?? null, options.free === true],
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

/**
 * Cache chiffre, pour les reponses qui contiennent des adresses nominatives
 * (F-604). Illisible avec les cles configurees, l'entree est traitee comme
 * absente : on repaiera plutot que de servir une reponse qu'on ne peut plus
 * relire.
 */
export async function readEncryptedCache<T>(
  cipher: Cipher,
  provider: string,
  operation: string,
  key: string,
): Promise<T | undefined> {
  const entree = await readCache<{ chiffre?: unknown }>(provider, operation, key);
  if (typeof entree?.chiffre !== 'string') return undefined;
  try {
    return cipher.decryptJson<T>(entree.chiffre);
  } catch (error) {
    if (error instanceof EncryptionError) return undefined;
    throw error;
  }
}

export async function writeEncryptedCache(
  cipher: Cipher,
  provider: string,
  operation: string,
  key: string,
  response: unknown,
  ttlDays: number,
): Promise<void> {
  await writeCache(provider, operation, key, { chiffre: cipher.encryptJson(response) }, ttlDays);
}

export type PaidCallOutcome<T> =
  | { readonly kind: 'ok'; readonly value: T; readonly paid: boolean }
  | {
      readonly kind: 'skipped';
      readonly reason: 'interrupted' | 'already_settled' | 'user_quota' | 'global_quota' | 'budget';
    }
  | { readonly kind: 'failed'; readonly error: unknown };

/**
 * Un appel paye, du cache au reglement, tel que la regle du depot l'exige :
 * le cache d'abord, qui ne coute rien ; sinon une reservation, qui respecte
 * les plafonds et ne se fait qu'une fois par cle ; puis l'appel, son
 * resultat au cache, et le reglement. Brave et Hunter passent tous deux par
 * ici, pour qu'aucun des deux ne puisse l'oublier.
 */
export async function paidCall<T>(options: {
  readonly scope: CallScope;
  readonly limits: CallLimits;
  readonly cacheKey: string;
  readonly ttlDays: number;
  /** Present, la reponse est chiffree au cache (F-604). */
  readonly cipher?: Cipher;
  readonly call: () => Promise<T>;
  /** Vrai quand le fournisseur n'a pas facture cette reponse : reglee a zero. */
  readonly isFree?: (value: T) => boolean;
}): Promise<PaidCallOutcome<T>> {
  const { scope, cipher } = options;
  const lire = () =>
    cipher === undefined
      ? readCache<T>(scope.provider, scope.operation, options.cacheKey)
      : readEncryptedCache<T>(cipher, scope.provider, scope.operation, options.cacheKey);

  const connue = await lire();
  if (connue !== undefined) return { kind: 'ok', value: connue, paid: false };

  const reservation = await reserveCall(scope, options.limits);
  switch (reservation.kind) {
    case 'already_settled': {
      const apres = await lire();
      return apres === undefined
        ? { kind: 'skipped', reason: 'already_settled' }
        : { kind: 'ok', value: apres, paid: false };
    }
    case 'interrupted':
      return { kind: 'skipped', reason: 'interrupted' };
    case 'user_quota_reached':
      return { kind: 'skipped', reason: 'user_quota' };
    case 'global_quota_reached':
      return { kind: 'skipped', reason: 'global_quota' };
    case 'budget_reached':
      return { kind: 'skipped', reason: 'budget' };
    case 'reserved':
      break;
  }

  try {
    const value = await options.call();
    if (cipher === undefined) {
      await writeCache(scope.provider, scope.operation, options.cacheKey, value, options.ttlDays);
    } else {
      await writeEncryptedCache(
        cipher,
        scope.provider,
        scope.operation,
        options.cacheKey,
        value,
        options.ttlDays,
      );
    }
    const gratuit = options.isFree?.(value) === true;
    await settleCall(reservation.id, 'confirmed', undefined, { free: gratuit });
    return { kind: 'ok', value, paid: !gratuit };
  } catch (error) {
    await settleCall(
      reservation.id,
      'failed',
      error instanceof Error ? error.message.slice(0, 500) : 'erreur',
    );
    return { kind: 'failed', error };
  }
}
