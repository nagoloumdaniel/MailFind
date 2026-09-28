import { Queue, UnrecoverableError } from 'bullmq';
import { getQueueConnection, queuePrefix } from './connection.js';

export const IMPORT_QUEUE = 'import';

export interface ImportPlanJob {
  readonly importId: string;
  readonly userId: string;
}

let queue: Queue<ImportPlanJob> | undefined;

export function getImportQueue(): Queue<ImportPlanJob> {
  queue ??= new Queue<ImportPlanJob>(IMPORT_QUEUE, {
    connection: getQueueConnection(),
    prefix: queuePrefix(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      // Redis Cloud offre trente megaoctets : une tache terminee qui reste en
      // memoire est de la place prise a celles qui arrivent. On garde de quoi
      // enqueter, pas davantage.
      removeOnComplete: { age: 3600, count: 100 },
      removeOnFail: { age: 24 * 3600, count: 200 },
    },
  });
  return queue;
}

/**
 * Identifiant stable, derive de l'import. La meme planification ne peut pas
 * etre mise en file deux fois, et une reprise apres coupure retombe sur la
 * meme tache (F-206, section 8.4).
 */
export function importPlanJobId(importId: string): string {
  // Sans deux-points : BullMQ les refuse dans un identifiant choisi, parce
  // qu'il s'en sert lui-meme pour construire ses cles Redis.
  return `import-plan-${importId}`;
}

export async function enqueueImportPlan(job: ImportPlanJob): Promise<void> {
  await getImportQueue().add('import.plan', job, { jobId: importPlanJobId(job.importId) });
}

/**
 * Vrai quand BullMQ ne retentera plus la tache.
 *
 * L'evenement `failed` part a chaque echec, y compris ceux qui seront
 * retentes : sans ce tri, un import serait declare en echec des la premiere
 * coupure reseau, alors qu'il allait reprendre tout seul cinq secondes plus
 * tard. BullMQ a deja compte la tentative quand l'evenement part.
 */
export function isFinalFailure(
  job: { readonly attemptsMade: number; readonly opts: { readonly attempts?: number } },
  error: Error,
): boolean {
  if (error instanceof UnrecoverableError || error.name === 'UnrecoverableError') return true;
  return job.attemptsMade >= (job.opts.attempts ?? 1);
}

/**
 * La file des etapes par entreprise (section 8.4) : `company.identify` puis
 * `company.crawl`. Separee de celle des imports pour qu'un import de cinq
 * mille lignes planifie sans attendre la collecte d'un autre.
 */
export const COMPANY_QUEUE = 'company';

export type CompanyStep = 'identify' | 'crawl';

export interface CompanyJob {
  readonly importId: string;
  readonly companyId: string;
  readonly userId: string;
}

let fileEntreprises: Queue<CompanyJob> | undefined;

export function getCompanyQueue(): Queue<CompanyJob> {
  fileEntreprises ??= new Queue<CompanyJob>(COMPANY_QUEUE, {
    connection: getQueueConnection(),
    prefix: queuePrefix(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: { age: 3600, count: 500 },
      removeOnFail: { age: 24 * 3600, count: 500 },
    },
  });
  return fileEntreprises;
}

/** Une etape par entreprise et par import : la meme ne peut pas etre en file deux fois. */
export function companyJobId(step: CompanyStep, job: CompanyJob): string {
  return `${step}-${job.importId}-${job.companyId}`;
}

export async function enqueueCompanyStep(step: CompanyStep, job: CompanyJob): Promise<void> {
  await getCompanyQueue().add(`company.${step}`, job, { jobId: companyJobId(step, job) });
}

export async function closeImportQueue(): Promise<void> {
  const fermetures: Promise<void>[] = [];
  if (queue !== undefined) fermetures.push(queue.close());
  if (fileEntreprises !== undefined) fermetures.push(fileEntreprises.close());
  queue = undefined;
  fileEntreprises = undefined;
  await Promise.all(fermetures);
}
