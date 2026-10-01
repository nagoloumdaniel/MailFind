import { query } from '../db/pool.js';
import { getLogger } from '../observability/logger.js';
import type { Enqueue } from '../pipeline/start.js';
import { takeQuotaBlockedSteps } from '../pipeline/steps.js';
import { quotaLimits, readUsage, type QuotaMetric } from './usage.js';

/**
 * Reprise des entreprises qu'un quota avait arretees (F-1403).
 *
 * Deux chemins, le meme code : l'utilisateur relance son import, ou le mois
 * se renouvelle et l'entretien reprend tout ce qui attendait. Dans les deux
 * cas on verifie d'abord qu'il reste de la place : remettre en file pour se
 * faire arreter aussitot ferait tourner la file pour rien.
 */

/** Ce qui manque pour reprendre, ou rien quand la place est la. */
export function missingQuota(
  consomme: Record<QuotaMetric, number>,
  plafonds: Record<QuotaMetric, number>,
): QuotaMetric | undefined {
  if (consomme.companies >= plafonds.companies) return 'companies';
  if (consomme.pages >= plafonds.pages) return 'pages';
  return undefined;
}

export interface ResumeOutcome {
  readonly resumed: number;
  /** Le compteur encore plein, quand rien n'a pu repartir. */
  readonly blockedBy?: QuotaMetric;
}

export async function resumeBlocked(
  userId: string,
  enqueue: Enqueue,
  importId?: string,
): Promise<ResumeOutcome> {
  const manquant = missingQuota(await readUsage(userId), quotaLimits());
  if (manquant !== undefined) return { resumed: 0, blockedBy: manquant };

  const etapes = await takeQuotaBlockedSteps(userId, importId);
  if (etapes.length === 0) return { resumed: 0 };

  // L'import repasse en cours avant la mise en file : sinon une etape qui
  // finit tout de suite le trouverait deja conclu.
  const imports = [...new Set(etapes.map((e) => e.job.importId))];
  await query(
    `update imports set status = 'running', completed_at = null
      where id = any($1::uuid[]) and status = 'quota_blocked'`,
    [imports],
  );

  for (const { step, job } of etapes) await enqueue(step, job);
  return { resumed: etapes.length };
}

/**
 * L'entretien quotidien : tout ce qui attend repart des que le compteur du
 * compte le permet, sans que personne ait a cliquer.
 */
export async function resumeBlockedForEveryone(enqueue: Enqueue): Promise<number> {
  const comptes = await query<{ user_id: string }>(
    `select distinct i.user_id
       from pipeline_jobs p join imports i on i.id = p.import_id
      where p.status = 'quota_blocked'`,
  );

  let repris = 0;
  for (const { user_id: userId } of comptes.rows) {
    const issue = await resumeBlocked(userId, enqueue);
    repris += issue.resumed;
  }
  if (repris > 0) getLogger().info({ etapes: repris }, 'etapes reprises apres quota');
  return repris;
}
