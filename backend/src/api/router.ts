import { Router } from 'express';
import { Redis } from 'ioredis';
import { requireApiKey } from '../api-keys/authenticate.js';
import { getEnvironment } from '../config/env.js';
import { requireAcceptedTerms } from '../http/middleware/require-terms.js';
import { notFoundHandler } from '../http/middleware/error-handler.js';
import { getLogger } from '../observability/logger.js';
import type { Enqueue } from '../pipeline/start.js';
import type { VerifyDeps } from '../pipeline/verify.js';
import { createConfiguredCipher, createVerifyDeps } from '../pipeline/verify-deps.js';
import type { Cipher } from '../security/crypto.js';
import {
  enqueueCampaignMailerPush,
  enqueueCompanyStep,
  enqueueExportBuild,
} from '../queue/queues.js';
import { createR2Storage, type ExportStorage } from '../exports/storage.js';
import type { MailDns } from '../verification/local.js';
import { idempotency } from './idempotency.js';
import { buildOpenApiDocument } from './openapi/document.js';
import { registerV1Routes } from './v1/index.js';
import { importBodyParser } from './v1/imports.js';
import { createRedisRateLimitStore, rateLimit, type RateLimitStore } from './rate-limit.js';

export interface V1Options {
  /** Le compteur de debit ; Redis par defaut, la memoire dans les tests. */
  readonly rateLimitStore?: RateLimitStore;
  /** La file des etapes par entreprise ; celle de BullMQ par defaut. */
  readonly enqueue?: Enqueue;
  /** La verification des adresses ; les tests y mettent un DNS simule. */
  readonly verify?: VerifyDeps;
  /** Ou deposer les exports ; R2 par defaut. */
  readonly exportStorage?: () => ExportStorage | undefined;
  readonly enqueueExport?: (exportId: string, userId: string) => Promise<void>;
  /** Le DNS de la verification d'une liste ; simule dans les tests. */
  readonly dns?: MailDns;
  /** Le chiffrement des secrets de webhook ; celui de ENCRYPTION_KEY par defaut. */
  readonly cipher?: Cipher;
  /** La mise en file d'un envoi vers Campaign Mailer ; celle de BullMQ par defaut. */
  readonly enqueuePush?: (pushId: string) => Promise<void>;
  /** Pour les tests : des routes montees apres les conventions communes. */
  readonly register?: (router: Router) => void;
}

let compteurRedis: RateLimitStore | undefined;

/**
 * Un client Redis a part : celui des files attend sans fin qu'une commande
 * aboutisse (exigence de BullMQ), et une requete d'API ne doit pas rester
 * pendue derriere une panne de Redis.
 */
export function defaultRateLimitStore(): RateLimitStore {
  const environment = getEnvironment();
  compteurRedis ??= createRedisRateLimitStore(
    new Redis(environment.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true }),
    `${environment.BULLMQ_PREFIX}:ratelimit:`,
  );
  return compteurRedis;
}

/**
 * L'API publique `/v1` (F-1301). Montee avant la session et le jeton CSRF :
 * elle ne porte ni cookie ni session, seulement une cle d'API. Chaque requete
 * passe, dans l'ordre, par l'authentification, la limitation de debit par
 * cle, puis l'idempotence des creations.
 */
export function createV1Router(options: V1Options = {}): Router {
  const router = Router();
  const environment = getEnvironment();

  // Le document se lit sans cle : on doit pouvoir decouvrir l'API avant d'y
  // avoir un compte. Construit une fois, au premier appel.
  let document: object | undefined;
  router.get('/openapi.json', (_req, res) => {
    document ??= buildOpenApiDocument(environment.API_URL);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(document);
  });

  router.use(requireApiKey(), requireAcceptedTerms);
  router.use(
    rateLimit({
      store: () => options.rateLimitStore ?? defaultRateLimitStore(),
      key: (req) => {
        const cle = req.apiKey?.id;
        return cle === undefined ? undefined : `api:${cle}`;
      },
      limit: environment.API_RATE_LIMIT_PER_MINUTE,
      onStoreError: (error) => {
        getLogger().warn({ err: error }, 'compteur de debit indisponible, requete laissee passer');
      },
    }),
  );
  // Le corps d'un import depasse la limite generale, que le lecteur global
  // lui epargne : il est lu ici, avant l'idempotence qui en tire l'empreinte.
  router.use((req, res, next) => {
    if (req.method === 'POST' && req.path === '/imports') importBodyParser(req, res, next);
    else next();
  });
  router.use(idempotency({ except: ['/webhooks'] }));

  // Construite au premier besoin : lire la configuration des fournisseurs n'a
  // pas a bloquer le demarrage de l'API.
  let verification = options.verify;
  let stockage: { valeur: ExportStorage | undefined } | undefined;
  registerV1Routes(router, {
    enqueue: options.enqueue ?? enqueueCompanyStep,
    verifyDeps: () => (verification ??= createVerifyDeps()),
    exportStorage:
      options.exportStorage ?? (() => (stockage ??= { valeur: createR2Storage() }).valeur),
    enqueueExport: options.enqueueExport ?? enqueueExportBuild,
    ...(options.dns === undefined ? {} : { dns: options.dns }),
    cipher: () => options.cipher ?? createConfiguredCipher(),
    enqueuePush: options.enqueuePush ?? enqueueCampaignMailerPush,
  });
  options.register?.(router);

  // Une route inconnue s'arrete ici, sans descendre vers la session.
  router.use(notFoundHandler);
  return router;
}
