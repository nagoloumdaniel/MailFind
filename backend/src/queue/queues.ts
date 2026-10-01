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
 * La file des etapes par entreprise (section 8.4) : `company.identify`, puis
 * `company.crawl`, `company.enrich` et `company.verify`. Separee de celle des imports pour qu'un import de cinq
 * mille lignes planifie sans attendre la collecte d'un autre.
 */
export const COMPANY_QUEUE = 'company';

export type CompanyStep = 'identify' | 'crawl' | 'enrich' | 'verify';

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

/**
 * Taches d'entretien, sans rapport avec un import : le rechargement hebdomadaire
 * de la liste des domaines jetables (niveau 4 de 6.7).
 */
export const MAINTENANCE_QUEUE = 'maintenance';
const UNE_SEMAINE_MS = 7 * 24 * 60 * 60 * 1000;

let fileEntretien: Queue | undefined;

export function getMaintenanceQueue(): Queue {
  fileEntretien ??= new Queue(MAINTENANCE_QUEUE, {
    connection: getQueueConnection(),
    prefix: queuePrefix(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
    },
  });
  return fileEntretien;
}

/**
 * Le planificateur est idempotent : chaque processus de traitement le
 * declare a son demarrage, et BullMQ n'en garde qu'un.
 */
export async function scheduleMaintenance(): Promise<void> {
  await getMaintenanceQueue().upsertJobScheduler(
    'disposable-domains',
    { every: UNE_SEMAINE_MS },
    { name: 'disposable.refresh' },
  );
  // F-1104 : les exports de plus de sept jours sont effaces, une fois par jour.
  await getMaintenanceQueue().upsertJobScheduler(
    'exports-purge',
    { every: 24 * 60 * 60 * 1000 },
    { name: 'exports.purge' },
  );
  // F-1403 : ce qu'un quota a arrete repart des que le compteur le permet,
  // sans que personne ait a cliquer. Une fois par jour suffit : les quotas se
  // renouvellent au mois.
  await getMaintenanceQueue().upsertJobScheduler(
    'quotas-resume',
    { every: 24 * 60 * 60 * 1000 },
    { name: 'quotas.resume' },
  );
  // F-1305 : les cles d'idempotence de plus de 24 heures, une fois par jour.
  await getMaintenanceQueue().upsertJobScheduler(
    'idempotency-purge',
    { every: 24 * 60 * 60 * 1000 },
    { name: 'idempotency.purge' },
  );
  // Les verifications en tache de l'API, gardees sept jours.
  await getMaintenanceQueue().upsertJobScheduler(
    'verification-runs-purge',
    { every: 24 * 60 * 60 * 1000 },
    { name: 'verification-runs.purge' },
  );
}

/**
 * Une livraison de webhook (F-1308) : quatre tentatives, la premiere puis
 * trois nouvelles, a 30 secondes, 1 minute puis 2 minutes.
 */
export async function enqueueWebhookDelivery(deliveryId: string): Promise<void> {
  await getMaintenanceQueue().add(
    'webhook.deliver',
    { deliveryId },
    {
      jobId: `webhook-${deliveryId}`,
      attempts: 4,
      backoff: { type: 'exponential', delay: 30_000 },
    },
  );
}

/**
 * Un envoi vers Campaign Mailer (F-1205). Cinq tentatives espacees de 30 s,
 * 1, 2 puis 4 minutes : un debit depasse ou une panne passagere de Campaign
 * Mailer se resorbe, et chaque reprise repart du lot ou l'envoi s'etait
 * arrete, sous les memes cles d'idempotence.
 */
export async function enqueueCampaignMailerPush(pushId: string): Promise<void> {
  await getMaintenanceQueue().add(
    'campaign-mailer.push',
    { pushId },
    {
      jobId: `campaign-mailer-${pushId}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
    },
  );
}

/** Une verification en tache de l'API ; l'identifiant suit le sien : elle ne part qu'une fois. */
export async function enqueueVerificationRun(runId: string): Promise<void> {
  await getMaintenanceQueue().add(
    'verification.run',
    { runId },
    { jobId: `verification-${runId}` },
  );
}

/**
 * F-1104 : un export volumineux est produit par le processus de traitement.
 * L'identifiant de la tache suit celui de l'export : il ne part qu'une fois.
 */
export async function enqueueExportBuild(exportId: string, userId: string): Promise<void> {
  await getMaintenanceQueue().add(
    'export.build',
    { exportId, userId },
    { jobId: `export-${exportId}` },
  );
}

export async function closeImportQueue(): Promise<void> {
  const fermetures: Promise<void>[] = [];
  if (queue !== undefined) fermetures.push(queue.close());
  if (fileEntreprises !== undefined) fermetures.push(fileEntreprises.close());
  if (fileEntretien !== undefined) fermetures.push(fileEntretien.close());
  queue = undefined;
  fileEntreprises = undefined;
  fileEntretien = undefined;
  await Promise.all(fermetures);
}
