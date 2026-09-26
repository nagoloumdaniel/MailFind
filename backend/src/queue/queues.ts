import { Queue } from 'bullmq';
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

export async function closeImportQueue(): Promise<void> {
  if (queue === undefined) return;
  const fermeture = queue;
  queue = undefined;
  await fermeture.close();
}
