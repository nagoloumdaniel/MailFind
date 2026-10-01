import { query } from '../db/pool.js';
import { getEnvironment } from '../config/env.js';

/**
 * Quotas par utilisateur et par mois (F-1401).
 *
 * Ce qui se compte ici n'a pas de prix : des entreprises, des pages, des
 * exports. Ce qui coute un credit est compte ailleurs, dans `provider_calls`,
 * ou la reservation precede l'appel (section 8.4).
 *
 * Prendre une place et refuser la suivante se fait en une seule instruction :
 * le `where` de l'upsert laisse la ligne intacte quand le plafond est atteint,
 * et rien n'est rendu. Deux processus ne peuvent donc pas prendre la meme
 * derniere place.
 */

export const QUOTA_METRICS = ['companies', 'pages', 'exports'] as const;
export type QuotaMetric = (typeof QUOTA_METRICS)[number];

/** Le plafond mensuel de chaque compteur, tel que l'exploitant l'a fixe. */
export function quotaLimits(): Record<QuotaMetric, number> {
  const environment = getEnvironment();
  return {
    companies: environment.QUOTA_COMPANIES_PER_USER_PER_MONTH,
    pages: environment.QUOTA_PAGES_PER_USER_PER_MONTH,
    exports: environment.QUOTA_EXPORTS_PER_USER_PER_MONTH,
  };
}

export interface QuotaClaim {
  readonly granted: boolean;
  /** Ce qui reste apres l'operation, ou ce qui restait quand elle est refusee. */
  readonly remaining: number;
  readonly limit: number;
}

/**
 * Prend `amount` places sur un compteur, ou n'en prend aucune. Jamais une
 * partie : un import a moitie explore est plus difficile a lire qu'un import
 * arrete net.
 */
export async function claimQuota(
  userId: string,
  metric: QuotaMetric,
  amount = 1,
): Promise<QuotaClaim> {
  const limit = quotaLimits()[metric];
  if (amount <= 0) return { granted: true, remaining: limit, limit };

  const result = await query<{ used: number }>(
    `insert into quota_usage (user_id, period, metric, used)
     select $1::uuid, date_trunc('month', now() at time zone 'utc')::date,
            $2::quota_metric, $3::int
      where $3::int <= $4::int
     on conflict (user_id, period, metric) do update
        set used = quota_usage.used + $3::int, updated_at = now()
      where quota_usage.used + $3::int <= $4::int
     returning used`,
    [userId, metric, amount, limit],
  );

  const used = result.rows[0]?.used;
  if (used === undefined) {
    return {
      granted: false,
      remaining: Math.max(0, limit - (await readUsage(userId))[metric]),
      limit,
    };
  }
  return { granted: true, remaining: Math.max(0, limit - used), limit };
}

/**
 * Rend des places prises pour une operation qui n'a finalement pas eu lieu.
 * Sans cela, une panne apres la prise ferait payer un quota pour rien.
 */
export async function releaseQuota(userId: string, metric: QuotaMetric, amount = 1): Promise<void> {
  if (amount <= 0) return;
  await query(
    `update quota_usage
        set used = greatest(0, used - $3::int), updated_at = now()
      where user_id = $1::uuid and metric = $2::quota_metric
        and period = date_trunc('month', now() at time zone 'utc')::date`,
    [userId, metric, amount],
  );
}

/** Ce que le compte a consomme ce mois-ci, zero compris (F-1404). */
export async function readUsage(userId: string): Promise<Record<QuotaMetric, number>> {
  const result = await query<{ metric: QuotaMetric; used: number }>(
    `select metric::text as metric, used from quota_usage
      where user_id = $1
        and period = date_trunc('month', now() at time zone 'utc')::date`,
    [userId],
  );
  const consomme: Record<QuotaMetric, number> = { companies: 0, pages: 0, exports: 0 };
  for (const ligne of result.rows) consomme[ligne.metric] = ligne.used;
  return consomme;
}

export interface QuotaReport {
  readonly metric: QuotaMetric;
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
}

/** Les trois compteurs avec leur plafond, pour l'affichage et pour l'API. */
export async function quotaReport(userId: string): Promise<QuotaReport[]> {
  const [consomme, plafonds] = [await readUsage(userId), quotaLimits()];
  return QUOTA_METRICS.map((metric) => ({
    metric,
    used: consomme[metric],
    limit: plafonds[metric],
    remaining: Math.max(0, plafonds[metric] - consomme[metric]),
  }));
}
