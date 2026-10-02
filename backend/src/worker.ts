import { UnrecoverableError, Worker } from 'bullmq';
import { initErrorReporting, reportError } from './observability/errors.js';
import { resumeBlockedForEveryone } from './quotas/resume.js';
import { purgeExpiredData } from './retention/purge.js';
import { writeWorkerHeartbeat } from './observability/readiness.js';
import { runAlertChecks } from './observability/alerts.js';
import { createBackup } from './backup/dump.js';
import { purgeExpiredExports, runExportJob } from './exports/service.js';
import { purgeExpiredIdempotencyKeys } from './api/idempotency.js';
import { purgeExpiredVerificationRuns, runVerification } from './verification/runs.js';
import { deliverWebhook } from './webhooks/service.js';
import { runPush } from './campaign-mailer/push.js';
import { createFetcher, type Fetcher } from './net/safe-fetch.js';
import { createConfiguredCipher } from './pipeline/verify-deps.js';
import { createR2Storage } from './exports/storage.js';
import { closePool, query } from './db/pool.js';
import { listImportsToResume, markImportFailed, planImport } from './imports/plan.js';
import { getLogger } from './observability/logger.js';
import { crawlStep, failStep } from './pipeline/crawl.js';
import { createPipelineDeps } from './pipeline/deps.js';
import { enrichStep } from './pipeline/enrich.js';
import { identifyCompany } from './pipeline/identify.js';
import { startPipeline } from './pipeline/start.js';
import { listStepsToResume, planStep } from './pipeline/steps.js';
import { verifyStep } from './pipeline/verify.js';
import { closeQueueConnection, getQueueConnection, queuePrefix } from './queue/connection.js';
import { getEnvironment } from './config/env.js';
import { refreshDisposableDomains } from './verification/disposable.js';
import {
  closeImportQueue,
  COMPANY_QUEUE,
  getMaintenanceQueue,
  MAINTENANCE_QUEUE,
  scheduleMaintenance,
  enqueueCompanyStep,
  enqueueImportPlan,
  IMPORT_QUEUE,
  isFinalFailure,
  type CompanyJob,
  type CompanyStep,
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

initErrorReporting('worker');
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
    else if (job.name === 'company.enrich') await enrichStep(dependances, job.data);
    else if (job.name === 'company.verify') await verifyStep(dependances, job.data);
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

/** Le client des webhooks : la garde des adresses, a part de celui de la collecte. */
let fetcherWebhooks: Fetcher | undefined;

const entretien = new Worker(
  MAINTENANCE_QUEUE,
  async (job) => {
    if (job.name === 'export.build' || job.name === 'exports.purge') {
      const stockage = createR2Storage();
      if (stockage === undefined) {
        throw new UnrecoverableError('Stockage des exports non configure (R2).');
      }
      if (job.name === 'exports.purge') return { effaces: await purgeExpiredExports(stockage) };
      const { exportId } = job.data as { exportId: string };
      await runExportJob(stockage, exportId);
      return { exportId };
    }
    if (job.name === 'idempotency.purge') {
      return { effacees: await purgeExpiredIdempotencyKeys() };
    }
    if (job.name === 'backup.daily') {
      const stockage = createR2Storage();
      if (stockage === undefined) {
        throw new UnrecoverableError('Sauvegarde impossible : stockage R2 non configure.');
      }
      return await createBackup(stockage);
    }
    if (job.name === 'alerts.check') {
      return { alertes: (await runAlertChecks()).map((alerte) => alerte.kind) };
    }
    if (job.name === 'retention.purge') {
      return await purgeExpiredData();
    }
    if (job.name === 'quotas.resume') {
      return { reprises: await resumeBlockedForEveryone(enqueueCompanyStep) };
    }
    if (job.name === 'verification-runs.purge') {
      return { effacees: await purgeExpiredVerificationRuns() };
    }
    if (job.name === 'webhook.deliver') {
      const { deliveryId } = job.data as { deliveryId: string };
      await deliverWebhook(deliveryId, {
        fetcher: (fetcherWebhooks ??= createFetcher()),
        cipher: createConfiguredCipher(),
        // La derniere tentative laisse la livraison en echec au lieu de relancer.
        finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
      });
      return { deliveryId };
    }
    if (job.name === 'campaign-mailer.push') {
      const { pushId } = job.data as { pushId: string };
      await runPush(pushId, {
        cipher: createConfiguredCipher(),
        finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
      });
      return { pushId };
    }
    if (job.name === 'verification.run') {
      const { runId } = job.data as { runId: string };
      await runVerification(runId);
      return { runId };
    }
    if (job.name !== 'disposable.refresh') return undefined;
    const issue = await refreshDisposableDomains({ url: getEnvironment().DISPOSABLE_DOMAINS_URL });
    logger.info({ issue }, 'liste des domaines jetables');
    return issue;
  },
  { connection: getQueueConnection(), prefix: queuePrefix(), concurrency: 1 },
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
  reportError(error, {
    service: 'worker',
    job: job.name,
    ...(job.id === undefined ? {} : { jobId: job.id }),
    attempt: job.attemptsMade,
    userId: job.data.userId,
  });
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
  // Seul l'abandon definitif part chez Sentry : une tentative qui sera
  // retentee n'est pas une incidence.
  reportError(error, {
    service: 'worker',
    job: job.name,
    ...(job.id === undefined ? {} : { jobId: job.id }),
    attempt: job.attemptsMade,
    userId: job.data.userId,
  });
  const etapes: Record<string, CompanyStep> = {
    'company.identify': 'identify',
    'company.crawl': 'crawl',
    'company.enrich': 'enrich',
    'company.verify': 'verify',
  };
  const etape = etapes[job.name] ?? 'crawl';
  // Un enrichissement abandonne n'empeche pas de verifier ce que la collecte a
  // trouve. La verification est declaree avant l'echec, pour que l'import ne
  // se croie pas termine entre les deux.
  const suite = etape === 'enrich';
  void (async () => {
    if (suite) await planStep('verify', job.data);
    // Le motif montre a l'utilisateur reste general : le detail technique est
    // dans les journaux (S-03).
    await failStep(etape, job.data, "L'etape a echoue apres plusieurs tentatives.");
    if (suite) await enqueueCompanyStep('verify', job.data);
  })().catch((erreur: unknown) => {
    logger.error({ jobId: job.id, err: erreur }, "l'echec de l'etape n'a pas pu etre note");
  });
});

logger.info({ queues: [IMPORT_QUEUE, COMPANY_QUEUE] }, "processus de traitement a l'ecoute");

/**
 * Le battement de coeur que lit `/ready` (section 12). Sans lui, une file
 * vide et un processus arrete se ressemblent, et un import reste « pending »
 * sans que rien ne le signale.
 *
 * `unref` : il ne doit pas retenir le processus a l'arret.
 */
const BATTEMENT_MS = 30_000;
void writeWorkerHeartbeat().catch((erreur: unknown) => {
  logger.warn({ err: erreur }, 'battement de coeur non ecrit');
});
setInterval(() => {
  void writeWorkerHeartbeat().catch((erreur: unknown) => {
    logger.warn({ err: erreur }, 'battement de coeur non ecrit');
  });
}, BATTEMENT_MS).unref();

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

// La liste des domaines jetables se recharge chaque semaine ; sur une base
// neuve, elle se charge tout de suite plutot que dans sept jours.
try {
  await scheduleMaintenance();
  const connus = await query<{ n: number }>('select count(*)::int as n from disposable_domains');
  if ((connus.rows[0]?.n ?? 0) === 0) {
    await getMaintenanceQueue().add(
      'disposable.refresh',
      {},
      { jobId: 'disposable-refresh-initial' },
    );
  }
} catch (error) {
  logger.error({ err: error }, 'entretien non planifie');
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'arret demande');
  // `close` attend la fin de la tache en cours : une tache coupee au milieu
  // repartirait de zero, alors qu'elle sait reprendre.
  await Promise.all([planification.close(), collecte.close(), entretien.close()]);
  await dependances.fetcher.close();
  await closeImportQueue();
  await closeQueueConnection();
  await closePool();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
