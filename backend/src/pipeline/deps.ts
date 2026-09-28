import { createCrawlerClient } from '../crawler/client.js';
import { createRedisGate } from '../crawler/politeness.js';
import { getEnvironment } from '../config/env.js';
import { createFetcher, type Fetcher } from '../net/safe-fetch.js';
import {
  createRechercheEntreprisesClient,
  RECHERCHE_ENTREPRISES_INTERVAL_MS,
} from '../providers/recherche-entreprises.js';
import type { EnrichmentProvider } from '../providers/enrichment.js';
import { createHunter, createHunterVerifier } from '../providers/hunter.js';
import { createBraveSearch } from '../providers/web-search.js';
import { getLogger } from '../observability/logger.js';
import { createCipher } from '../security/crypto.js';
import { getQueueConnection } from '../queue/connection.js';
import { enqueueCompanyStep } from '../queue/queues.js';
import type { CrawlDeps } from './crawl.js';
import type { EnrichDeps } from './enrich.js';
import type { IdentifyDeps } from './identify.js';
import type { VerifyDeps } from './verify.js';
import { loadDisposableDomains } from '../verification/disposable.js';
import { createMailDns } from '../verification/local.js';

/**
 * Les dependances reelles du pipeline, pour le processus de traitement. Les
 * tests en construisent d'autres, sur le jeu de sites local et des
 * fournisseurs simules.
 */
export function createPipelineDeps(): IdentifyDeps &
  CrawlDeps &
  EnrichDeps &
  VerifyDeps & { fetcher: Fetcher } {
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

  // Les fournisseurs d'enrichissement, dans l'ordre de repli (F-603), et
  // seulement ceux qui ont une cle. Sans cle de chiffrement, aucun : leurs
  // reponses contiennent des adresses nominatives, gardees chiffrees ou pas
  // du tout (F-604).
  const cipher =
    environment.ENCRYPTION_KEY === ''
      ? undefined
      : createCipher(environment.ENCRYPTION_KEY, environment.ENCRYPTION_KEY_PREVIOUS);
  const disponibles: Record<string, EnrichmentProvider | undefined> = {
    hunter:
      environment.HUNTER_API_KEY === ''
        ? undefined
        : createHunter({
            apiKey: environment.HUNTER_API_KEY,
            baseUrl: environment.HUNTER_BASE_URL,
          }),
  };
  const providers = environment.PROVIDER_ORDER.split(',')
    .map((nom) => disponibles[nom.trim().toLowerCase()])
    .filter((fournisseur): fournisseur is EnrichmentProvider => fournisseur !== undefined);
  if (providers.length > 0 && cipher === undefined) {
    getLogger().warn('ENCRYPTION_KEY vide : les fournisseurs d enrichissement restent desactives');
  }

  // La liste des domaines jetables change une fois la semaine : la relire a
  // chaque entreprise serait dix mille lignes pour rien.
  let jetables: { expire: number; liste: Promise<ReadonlySet<string>> } | undefined;
  const disposableDomains = () => {
    if (jetables === undefined || jetables.expire < Date.now()) {
      const liste = loadDisposableDomains();
      jetables = { expire: Date.now() + 60 * 60 * 1000, liste };
      // Un echec de lecture ne doit pas rester en memoire une heure.
      liste.catch(() => {
        jetables = undefined;
      });
    }
    return jetables.liste;
  };

  const cle = environment.BRAVE_SEARCH_API_KEY;
  return {
    mailDns: createMailDns(),
    disposableDomains,
    ...(cipher === undefined || environment.HUNTER_API_KEY === ''
      ? {}
      : {
          verifier: createHunterVerifier({
            apiKey: environment.HUNTER_API_KEY,
            baseUrl: environment.HUNTER_BASE_URL,
          }),
        }),
    // D-14 : les plafonds se comptent en credits, une verification en vaut un demi.
    verificationLimits: {
      perUserMonthly: environment.QUOTA_MAILBOX_VERIFICATIONS_PER_USER_PER_MONTH / 2,
      globalMonthly: environment.HUNTER_MONTHLY_VERIFICATION_CREDITS,
    },
    providers: cipher === undefined ? [] : providers,
    ...(cipher === undefined ? {} : { cipher }),
    providerLimits: {
      hunter: {
        perUserMonthly: environment.QUOTA_PROVIDER_SEARCHES_PER_USER_PER_MONTH,
        globalMonthly: environment.HUNTER_MONTHLY_SEARCH_CREDITS,
      },
    },
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
