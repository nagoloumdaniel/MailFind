import { createApp } from './app.js';
import { describeApp } from './app-info.js';
import { closePool } from './db/pool.js';
import { getEnvironment } from './config/env.js';
import { getLogger } from './observability/logger.js';

// En production, les variables viennent de l'hebergeur. En local, elles
// viennent de backend/.env, lu nativement par Node 24.
try {
  process.loadEnvFile('.env');
} catch {
  // Absence de fichier acceptee : la validation qui suit dira ce qui manque.
}

const environment = getEnvironment();
const logger = getLogger();
const server = createApp({ logger }).listen(environment.PORT, () => {
  logger.info({ port: environment.PORT, env: environment.NODE_ENV }, `${describeApp()} a l'ecoute`);
});

/**
 * Railway envoie SIGTERM avant de remplacer une instance. Fermer proprement
 * laisse les requetes en cours se terminer au lieu d'etre coupees au milieu.
 */
function shutdown(signal: string): void {
  logger.info({ signal }, 'arret demande');
  server.close(() => {
    void closePool().then(
      () => {
        logger.info('arret termine');
        process.exit(0);
      },
      (error: unknown) => {
        logger.error({ err: error }, 'fermeture de la base en echec');
        process.exit(1);
      },
    );
  });

  // Filet de securite : une connexion qui refuse de se fermer ne doit pas
  // bloquer le remplacement de l'instance.
  setTimeout(() => {
    logger.warn('arret force apres delai');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
