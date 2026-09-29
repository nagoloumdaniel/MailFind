import { getEnvironment } from '../config/env.js';
import { query } from '../db/pool.js';

/**
 * La consommation du mois d'un compte, dans l'unite des plafonds de D-14 :
 * des recherches et des verifications. Une seule definition pour le tableau
 * de bord et l'API (F-1309) : les deux doivent dire la meme chose que ce que
 * `reserveCall` compte au moment de payer.
 */
export interface CreditMeter {
  readonly provider: string;
  readonly operation: string;
  readonly used: number;
  readonly limit: number;
}

export async function monthlyUsage(userId: string): Promise<CreditMeter[]> {
  const environment = getEnvironment();
  // Comme reserveCall : ce qui a ete, ou a pu etre, paye, depuis le premier du
  // mois en UTC. Un appel regle a zero (recherche vide, non facturee) ne
  // compte pas.
  const lignes = await query<{ provider: string; operation: string; calls: number }>(
    `select provider, operation, count(*)::int as calls
       from provider_calls
      where user_id = $1 and status in ('reserved', 'confirmed') and credits > 0
        and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
      group by provider, operation`,
    [userId],
  );
  const utilise = (provider: string, operation: string) =>
    lignes.rows.find((l) => l.provider === provider && l.operation === operation)?.calls ?? 0;
  return [
    {
      provider: 'brave',
      operation: 'web_search',
      used: utilise('brave', 'web_search'),
      limit: environment.QUOTA_WEB_SEARCHES_PER_USER_PER_MONTH,
    },
    {
      provider: 'hunter',
      operation: 'domain_search',
      used: utilise('hunter', 'domain_search'),
      limit: environment.QUOTA_PROVIDER_SEARCHES_PER_USER_PER_MONTH,
    },
    {
      provider: 'hunter',
      operation: 'verification',
      used: utilise('hunter', 'verification'),
      limit: environment.QUOTA_MAILBOX_VERIFICATIONS_PER_USER_PER_MONTH,
    },
  ];
}
