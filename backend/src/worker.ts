import { Worker } from 'bullmq';
import { closePool } from './db/pool.js';
import { listImportsToResume, markImportFailed, planImport } from './imports/plan.js';
import { getLogger } from './observability/logger.js';
import { crawlStep, failStep } from './pipeline/crawl.js';
import { createPipelineDeps } from './pipeline/deps.js';
import { identifyCompany } from './pipeline/identify.js';
import { startPipeline } from './pipeline/start.js';
import { listStepsToResume } from './pipeline/steps.js';
import { closeQueueConnection, getQueueConnection, queuePrefix } from './queue/connection.js';
import {
  closeImportQueue,
  COMPANY_QUEUE,
  enqueueCompanyStep,
  enqueueImportPlan,
  IMPORT_QUEUE,
  isFinalFailure,
  type CompanyJob,
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
const dependances = createPipelineDeps();

const planification = new Worker<ImportPlanJob>(
  IMPORT_QUEUE,
  async (job) => {
    logger.info({ jobId: job.id, importId: job.data.importId }, 'tache prise');
    const issue = await planImport(job.data.importId, job.data.userId);
    // Dans la meme tache : une coupure entre les deux la fait rejouer en
    // entier, et les deux moities sont rejouables.
    const entreprises = await startPipeline(job.data.importId, job.data.userId, enqueueCompanyStep);
    return { ...issue, entreprises };
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

const collecte = new Worker<CompanyJob>(
  COMPANY_QUEUE,
  async (job) => {
    if (job.name === 'company.identify') await identifyCompany(dependances, job.data);
    else if (job.name === 'company.crawl') await crawlStep(dependances, job.data);
    else throw new Error(`Etape inconnue : ${job.name}`);
  },
  {
    connection: getQueueConnection(),
    prefix: queuePrefix(),
    // Le travail attend surtout le reseau, et la file par domaine garde chaque
    // site a une requete par seconde : plusieurs entreprises en parallele ne
    // chargent aucun site davantage.
    concurrency: 4,
  },
);

planification.on('completed', (job, resultat) => {
  logger.info({ jobId: job.id, resultat }, 'tache terminee');
});

planification.on('failed', (job, error) => {
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

collecte.on('failed', (job, error) => {
  if (job === undefined || !isFinalFailure(job, error)) {
    logger.warn({ jobId: job?.id, err: error }, 'etape en echec, retentee');
    return;
  }
  logger.error({ jobId: job.id, err: error }, 'etape abandonnee');
  const etape = job.name === 'company.identify' ? 'identify' : 'crawl';
  // Le motif montre a l'utilisateur reste general : le detail technique est
  // dans les journaux (S-03).
  void failStep(etape, job.data, "L'etape a echoue apres plusieurs tentatives.").catch(
    (erreur: unknown) => {
      logger.error({ jobId: job.id, err: erreur }, "l'echec de l'etape n'a pas pu etre note");
    },
  );
});

logger.info({ queues: [IMPORT_QUEUE, COMPANY_QUEUE] }, "processus de traitement a l'ecoute");

// Un import recu pendant que Redis etait indisponible, ou dont Redis a perdu
// la tache, ne serait repris par personne. Le remettre en file a chaque
// demarrage ne coute rien : l'identifiant stable ignore ceux qui y sont deja.
// Meme chose pour les etapes par entreprise d'un import en cours (F-206).
try {
  const enAttente = await listImportsToResume();
  for (const job of enAttente) await enqueueImportPlan(job);
  const etapes = await listStepsToResume();
  for (const { step, job } of etapes) await enqueueCompanyStep(step, job);
  if (enAttente.length + etapes.length > 0) {
    logger.info({ imports: enAttente.length, etapes: etapes.length }, 'travail remis en file');
  }
} catch (error) {
  logger.error({ err: error }, 'reprise du travail en attente impossible');
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'arret demande');
  // `close` attend la fin de la tache en cours : une tache coupee au milieu
  // repartirait de zero, alors qu'elle sait reprendre.
  await Promise.all([planification.close(), collecte.close()]);
  await dependances.fetcher.close();
  await closeImportQueue();
  await closeQueueConnection();
  await closePool();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
