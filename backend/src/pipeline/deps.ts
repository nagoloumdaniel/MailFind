import { createCrawlerClient } from '../crawler/client.js';
import { createRedisGate } from '../crawler/politeness.js';
import { getEnvironment } from '../config/env.js';
import { createFetcher, type Fetcher } from '../net/safe-fetch.js';
import {
  createRechercheEntreprisesClient,
  RECHERCHE_ENTREPRISES_INTERVAL_MS,
} from '../providers/recherche-entreprises.js';
import { createBraveSearch } from '../providers/web-search.js';
import { getQueueConnection } from '../queue/connection.js';
import { enqueueCompanyStep } from '../queue/queues.js';
import type { CrawlDeps } from './crawl.js';
import type { IdentifyDeps } from './identify.js';

/**
 * Les dependances reelles du pipeline, pour le processus de traitement. Les
 * tests en construisent d'autres, sur le jeu de sites local et des
 * fournisseurs simules.
 */
export function createPipelineDeps(): IdentifyDeps & CrawlDeps & { fetcher: Fetcher } {
  const environment = getEnvironment();
  const fetcher = createFetcher();
  // La file par domaine est dans Redis : tous les processus de traitement la
  // partagent (F-405).
  const gate = createRedisGate(getQueueConnection(), {
    prefix: 'mailfind',
    holdMs: environment.CRAWLER_REQUEST_TIMEOUT_MS,
  });

  const crawler = createCrawlerClient({
    fetcher,
    gate,
    userAgent: environment.CRAWLER_USER_AGENT,
    minIntervalMs: Math.ceil(1000 / environment.CRAWLER_REQUESTS_PER_SECOND_PER_DOMAIN),
  });

  const entreprises = createRechercheEntreprisesClient({
    baseUrl: environment.RECHERCHE_ENTREPRISES_BASE_URL,
    userAgent: environment.CRAWLER_USER_AGENT,
    throttle: (tache) =>
      gate.run('recherche-entreprises.api.gouv.fr', RECHERCHE_ENTREPRISES_INTERVAL_MS, tache),
  });

  const cle = environment.BRAVE_SEARCH_API_KEY;
  return {
    fetcher,
    crawler,
    entreprises,
    ...(cle === ''
      ? {}
      : {
          webSearch: createBraveSearch({
            apiKey: cle,
            baseUrl: environment.BRAVE_SEARCH_BASE_URL,
          }),
        }),
    webSearchLimits: {
      perUserMonthly: environment.QUOTA_WEB_SEARCHES_PER_USER_PER_MONTH,
      globalMonthly: environment.BRAVE_MONTHLY_FREE_QUERIES,
    },
    enqueue: enqueueCompanyStep,
  };
}
