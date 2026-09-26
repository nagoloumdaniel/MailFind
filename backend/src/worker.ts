import { Worker } from 'bullmq';
import { closePool } from './db/pool.js';
import { planImport } from './imports/plan.js';
import { getLogger } from './observability/logger.js';
import { closeQueueConnection, getQueueConnection, queuePrefix } from './queue/connection.js';
import { IMPORT_QUEUE, type ImportPlanJob } from './queue/queues.js';

/**
 * Processus de traitement, separe de l'API (section 8.3).
 *
 *   npm run dev:worker
 *
 * Le separer n'est pas une elegance : l'API doit rester disponible pendant
 * qu'un import de cinq mille lignes tourne, et la capacite s'augmente en
 * ajoutant des processus, sans changement de code.
 */
try {
  process.loadEnvFile('.env');
} catch {
  // En production, les variables viennent de l'hebergeur.
}

const logger = getLogger().child({ process: 'worker' });

const worker = new Worker<ImportPlanJob>(
  IMPORT_QUEUE,
  async (job) => {
    logger.info({ jobId: job.id, importId: job.data.importId }, 'tache prise');
    return planImport(job.data.importId, job.data.userId);
  },
  {
    connection: getQueueConnection(),
    prefix: queuePrefix(),
    // Un seul import a la fois par processus : le travail est domine par des
    // ecritures en base, et en lancer dix en parallele ne ferait que se
    // disputer la reserve de connexions.
    concurrency: 1,
  },
);

worker.on('completed', (job, resultat) => {
  logger.info({ jobId: job.id, resultat }, 'tache terminee');
});

worker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, err: error }, 'tache en echec');
});

logger.info({ queue: IMPORT_QUEUE }, "processus de traitement a l'ecoute");

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'arret demande');
  // `close` attend la fin de la tache en cours : une tache coupee au milieu
  // repartirait de zero, alors qu'elle sait reprendre.
  await worker.close();
  await closeQueueConnection();
  await closePool();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
