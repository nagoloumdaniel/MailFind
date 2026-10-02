import { query } from '../db/pool.js';
import { getEnvironment } from '../config/env.js';
import { budgetCents } from '../providers/budget.js';
import { getQueueConnection } from '../queue/connection.js';
import { reportError } from './errors.js';
import { getLogger } from './logger.js';
import { checkReadiness, type ReadinessReport } from './readiness.js';

/**
 * Les alertes de la section 12 : fournisseurs, files, depense, processus
 * silencieux.
 *
 * L'evaluation est separee de la collecte, et pure : ce qui declenche une
 * alerte se lit et se teste sans Redis ni base. Ce qui manque le plus a une
 * alerte, c'est d'etre juste ; une alerte qui crie pour rien finit ignoree, et
 * la vraie passe avec elle.
 */

/** Au-dessus, le fournisseur repond mal assez souvent pour le dire. */
export const PROVIDER_FAILURE_RATE = 0.2;
/** En dessous, le taux n'a aucun sens : trois appels dont un en echec font 33 %. */
export const PROVIDER_MIN_CALLS = 10;
/** Des taches qui attendent sans que rien ne les prenne. */
export const QUEUE_STUCK_WAITING = 50;
/** Part du budget consommee a partir de laquelle on previent, avant le mur. */
export const SPEND_WARNING_RATIO = 0.8;

export type AlertKind =
  'provider_failing' | 'queue_stuck' | 'worker_silent' | 'spend_near_budget' | 'dependency_down';

export interface Alert {
  readonly kind: AlertKind;
  readonly message: string;
  /** Ce qui, dans les chiffres, a declenche l'alerte. */
  readonly facts: Record<string, string | number>;
}

export interface ProviderHealth {
  readonly provider: string;
  readonly calls: number;
  readonly failures: number;
}

export interface AlertInput {
  readonly readiness: ReadinessReport;
  readonly providers: readonly ProviderHealth[];
  /** Depense du mois par fournisseur, en centimes. */
  readonly spentCents: Readonly<Record<string, number>>;
  readonly budgetCents: number;
}

export function evaluateAlerts(input: AlertInput): Alert[] {
  const alertes: Alert[] = [];

  for (const check of input.readiness.checks) {
    if (check.status === 'failed') {
      alertes.push({
        kind: 'dependency_down',
        message: `${check.name} ne repond pas : ${check.detail ?? 'sans detail'}.`,
        facts: { dependance: check.name, ms: check.ms },
      });
    }
  }

  // Une file qui grossit pendant que rien ne tourne : le signe que personne
  // ne prend le travail. Des taches actives disent au contraire que ca avance.
  for (const file of input.readiness.queues) {
    if (file.waiting >= QUEUE_STUCK_WAITING && file.active === 0) {
      alertes.push({
        kind: 'queue_stuck',
        message: `La file ${file.name} compte ${String(file.waiting)} taches en attente et aucune active.`,
        facts: { file: file.name, enAttente: file.waiting, enEchec: file.failed },
      });
    }
  }

  if (input.readiness.workerSeenAt === null) {
    alertes.push({
      kind: 'worker_silent',
      message:
        "Le processus de traitement n'a pas donne signe de vie : les imports resteront en attente.",
      facts: {},
    });
  }

  for (const { provider, calls, failures } of input.providers) {
    if (calls < PROVIDER_MIN_CALLS) continue;
    const taux = failures / calls;
    if (taux >= PROVIDER_FAILURE_RATE) {
      alertes.push({
        kind: 'provider_failing',
        message: `${provider} a echoue sur ${String(Math.round(taux * 100))} % des appels de la derniere heure.`,
        facts: { fournisseur: provider, appels: calls, echecs: failures },
      });
    }
  }

  if (input.budgetCents > 0) {
    for (const [provider, depense] of Object.entries(input.spentCents)) {
      const part = depense / input.budgetCents;
      if (part >= SPEND_WARNING_RATIO) {
        alertes.push({
          kind: 'spend_near_budget',
          message: `${provider} a consomme ${String(Math.round(part * 100))} % du budget du mois.`,
          facts: { fournisseur: provider, centimes: depense, budget: input.budgetCents },
        });
      }
    }
  }

  return alertes;
}

/** Les appels de la derniere heure, par fournisseur. */
export async function readProviderHealth(): Promise<ProviderHealth[]> {
  const lignes = await query<{ provider: string; calls: string; failures: string }>(
    `select provider,
            count(*)::text as calls,
            count(*) filter (where status = 'failed')::text as failures
       from provider_calls
      where created_at > now() - interval '1 hour'
      group by provider`,
  );
  return lignes.rows.map((ligne) => ({
    provider: ligne.provider,
    calls: Number(ligne.calls),
    failures: Number(ligne.failures),
  }));
}

export async function readMonthlySpend(): Promise<Record<string, number>> {
  const lignes = await query<{ provider: string; spent: string }>(
    `select provider, coalesce(sum(cost_cents), 0)::text as spent
       from provider_calls
      where status in ('reserved', 'confirmed')
        and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
      group by provider`,
  );
  return Object.fromEntries(lignes.rows.map((ligne) => [ligne.provider, Number(ligne.spent)]));
}

/**
 * La meme alerte ne part qu'une fois par heure : une file bouchee le reste
 * jusqu'a ce qu'on la debouche, et le dire toutes les cinq minutes noierait
 * le reste.
 */
const SILENCE_SECONDS = 3600;

async function premiereFois(kind: AlertKind, empreinte: string): Promise<boolean> {
  const cle = `${getEnvironment().BULLMQ_PREFIX}:alert:${kind}:${empreinte}`;
  const pose = await getQueueConnection().set(cle, '1', 'EX', SILENCE_SECONDS, 'NX');
  return pose === 'OK';
}

/** La tache d'entretien : evalue, et previent ce qui doit l'etre. */
export async function runAlertChecks(): Promise<Alert[]> {
  const [readiness, providers, spentCents] = await Promise.all([
    checkReadiness(getEnvironment().BULLMQ_PREFIX),
    readProviderHealth(),
    readMonthlySpend(),
  ]);

  const alertes = evaluateAlerts({
    readiness,
    providers,
    spentCents,
    budgetCents: budgetCents(),
  });

  const parties: Alert[] = [];
  for (const alerte of alertes) {
    const empreinte = Object.values(alerte.facts).slice(0, 1).join('') || alerte.kind;
    if (!(await premiereFois(alerte.kind, empreinte))) continue;
    getLogger().error({ alerte: alerte.kind, ...alerte.facts }, alerte.message);
    reportError(new Error(alerte.message), { service: 'worker' });
    parties.push(alerte);
  }
  return parties;
}
