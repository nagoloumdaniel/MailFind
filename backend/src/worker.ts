import { Worker } from 'bullmq';
import { closePool } from './db/pool.js';
import { listImportsToResume, markImportFailed, planImport } from './imports/plan.js';
import { getLogger } from './observability/logger.js';
import { closeQueueConnection, getQueueConnection, queuePrefix } from './queue/connection.js';
import {
  closeImportQueue,
  enqueueImportPlan,
  IMPORT_QUEUE,
  isFinalFailure,
  type ImportPlanJob,
} from './queue/queues.js';

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
  if (job === undefined) {
    logger.error({ err: error }, 'tache en echec');
    return;
  }

  if (!isFinalFailure(job, error)) {
    logger.warn(
      { jobId: job.id, err: error, tentative: job.attemptsMade },
      'tache en echec, retentee',
    );
    return;
  }

  logger.error({ jobId: job.id, err: error }, 'tache abandonnee');
  void markImportFailed(job.data.importId).catch((erreur: unknown) => {
    logger.error({ jobId: job.id, err: erreur }, "l'import n'a pas pu etre marque en echec");
  });
});

logger.info({ queue: IMPORT_QUEUE }, "processus de traitement a l'ecoute");

// Un import recu pendant que Redis etait indisponible, ou dont Redis a perdu
// la tache, ne serait repris par personne. Le remettre en file a chaque
// demarrage ne coute rien : l'identifiant stable ignore ceux qui y sont deja.
try {
  const enAttente = await listImportsToResume();
  for (const job of enAttente) await enqueueImportPlan(job);
  if (enAttente.length > 0) logger.info({ imports: enAttente.length }, 'imports remis en file');
} catch (error) {
  logger.error({ err: error }, 'reprise des imports en attente impossible');
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'arret demande');
  // `close` attend la fin de la tache en cours : une tache coupee au milieu
  // repartirait de zero, alors qu'elle sait reprendre.
  await worker.close();
  await closeImportQueue();
  await closeQueueConnection();
  await closePool();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
