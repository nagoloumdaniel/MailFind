import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import passport from 'passport';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { createAccountRouter } from './account/routes.js';
import { createApiKeysRouter } from './api-keys/routes.js';
import { createCampaignMailerRouter } from './campaign-mailer/routes.js';
import { createConfiguredCipher } from './pipeline/verify-deps.js';
import type { Cipher } from './security/crypto.js';
import { createV1Router, type V1Options } from './api/router.js';
import { createAuthRouter } from './auth/routes.js';
import { createSessionMiddleware } from './auth/session.js';
import { getEnvironment } from './config/env.js';
import { createImportsRouter } from './imports/routes.js';
import { createCompaniesRouter } from './companies/routes.js';
import { createContactsRouter } from './contacts/routes.js';
import { createDashboardRouter } from './dashboard/routes.js';
import { createExportsRouter } from './exports/routes.js';
import { createR2Storage, type ExportStorage } from './exports/storage.js';
import { enqueueCampaignMailerPush, enqueueExportBuild } from './queue/queues.js';
import type { Enqueue } from './pipeline/start.js';
import type { VerifyDeps } from './pipeline/verify.js';
import { createSuppressionsRouter } from './suppressions/routes.js';
import { createBotRouter } from './crawler/routes.js';
import {
  createCampaignMailerSignInRouter,
  type CampaignMailerSignInOptions,
} from './sso/client.js';
import { createSsoAuthorizeRouter, createSsoTokenRouter } from './sso/provider.js';
import { createVerificationsRouter } from './verification/routes.js';
import { getLogger, scrubbedRequest } from './observability/logger.js';
import { csrfProtection } from './http/middleware/csrf.js';
import { errorHandler, notFoundHandler } from './http/middleware/error-handler.js';
import { healthRouter } from './http/routes/health.js';

export interface AppOptions {
  readonly logger?: Logger;
  /**
   * Middleware de session. Injectable pour que les tests unitaires n'aient pas
   * besoin d'un Redis : la session est une infrastructure, pas une regle
   * metier.
   */
  readonly session?: RequestHandler;
  /** Verification des adresses saisies a la main ; les tests y mettent un DNS simule. */
  readonly verify?: VerifyDeps;
  /** La file des etapes par entreprise ; les tests la remplacent par une liste. */
  readonly enqueue?: Enqueue;
  /** Ou deposer les exports volumineux ; R2 par defaut, la memoire dans les tests. */
  readonly exportStorage?: ExportStorage;
  /** La mise en file d'un export volumineux. */
  readonly enqueueExport?: (exportId: string, userId: string) => Promise<void>;
  /** Le chiffrement des secrets (jeton Campaign Mailer) ; celui de ENCRYPTION_KEY par defaut. */
  readonly cipher?: Cipher;
  /** La mise en file d'un envoi vers Campaign Mailer. */
  readonly enqueuePush?: (pushId: string) => Promise<void>;
  /** L'API publique ; les tests y mettent un compteur de debit en memoire. */
  readonly v1?: V1Options;
  /** La connexion par Campaign Mailer ; les tests y mettent un faux echange. */
  readonly sso?: CampaignMailerSignInOptions;
}

/**
 * Construit l'application sans l'ecouter. Separer la construction de l'ecoute
 * permet aux tests de parler a l'application sans ouvrir de port.
 */
export function createApp(options: AppOptions = {}): Express {
  const logger = options.logger ?? getLogger();
  const environment = getEnvironment();
  const app = express();

  // Express annonce sa presence par defaut. Inutile a un client, utile a qui
  // cherche une version vulnerable.
  app.disable('x-powered-by');

  // Railway et Vercel terminent TLS en amont : sans cette confiance, l'IP
  // client vue par l'API est celle du proxy, ce qui fausserait la limitation
  // de debit, et `req.secure` serait faux derriere le relais de Vercel.
  app.set('trust proxy', environment.TRUST_PROXY_HOPS);

  app.use(helmet());

  app.use(
    cors({
      // Une seule origine, et les identifiants de session avec. Un `*` est
      // incompatible avec un cookie de session, et ouvrirait l'API a
      // n'importe quelle page.
      origin: environment.APP_URL,
      credentials: true,
    }),
  );

  app.use(
    pinoHttp({
      logger,
      // L'URL d'un retour de connexion porte un code et un etat (S-03).
      serializers: { req: scrubbedRequest },
      // Un identifiant par requete, repris de l'amont s'il existe : c'est ce
      // qui relie une erreur vue par l'utilisateur a une ligne de journal.
      genReqId: (req, res) => {
        const forwarded = req.headers['x-request-id'];
        const id = typeof forwarded === 'string' && forwarded !== '' ? forwarded : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      customLogLevel: (_req, res, error) => {
        if (error !== undefined || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  // Un megaoctet partout, sauf a la creation d'un import, qui lit son corps
  // elle-meme avec sa propre limite : sinon ce lecteur-ci, passe le premier,
  // refuserait un fichier de 5 000 lignes avant qu'elle ne le voie (F-201).
  const lecteurJson = express.json({ limit: '1mb' });
  app.use((req, res, next) => {
    if (req.method === 'POST' && (req.path === '/api/imports' || req.path === '/v1/imports')) {
      next();
      return;
    }
    lecteurJson(req, res, next);
  });

  // L'API publique avant la session et le jeton CSRF : un programme qui
  // l'appelle n'a ni cookie ni formulaire, seulement sa cle.
  app.use(
    '/v1',
    createV1Router({
      ...options.v1,
      ...(options.enqueue === undefined ? {} : { enqueue: options.enqueue }),
      ...(options.verify === undefined ? {} : { verify: options.verify }),
      ...(options.exportStorage === undefined
        ? {}
        : { exportStorage: () => options.exportStorage }),
      ...(options.enqueueExport === undefined ? {} : { enqueueExport: options.enqueueExport }),
      ...(options.enqueuePush === undefined ? {} : { enqueuePush: options.enqueuePush }),
    }),
  );

  // L'echange des codes de connexion croisee, de serveur a serveur : pas de
  // session ni de jeton CSRF, le secret partage en tient lieu (D-26).
  app.use('/api/sso', createSsoTokenRouter());

  // La page de l'agent de collecte et la demande d'exclusion, sans session :
  // un webmestre qui veut nous arreter n'a pas de compte chez nous (R-07).
  app.use('/api/bot', createBotRouter());

  // Avant toute route : `/health` n'a pas besoin de session, mais la poser ici
  // garde un seul ordre de middlewares a comprendre.
  app.use(options.session ?? createSessionMiddleware());
  app.use(passport.initialize());
  app.use(csrfProtection);

  app.use(healthRouter);
  app.use('/api/sso', createSsoAuthorizeRouter());
  app.use('/api/auth/campaign-mailer', createCampaignMailerSignInRouter(options.sso ?? {}));
  app.use('/api/auth', createAuthRouter());
  app.use('/api/account/api-keys', createApiKeysRouter());
  app.use(
    '/api/campaign-mailer',
    createCampaignMailerRouter({
      cipher: () => options.cipher ?? createConfiguredCipher(),
      enqueuePush: options.enqueuePush ?? enqueueCampaignMailerPush,
    }),
  );
  app.use('/api/account', createAccountRouter());
  app.use(
    '/api/imports',
    createImportsRouter(options.enqueue === undefined ? {} : { enqueue: options.enqueue }),
  );
  app.use(
    '/api/companies',
    createCompaniesRouter({
      ...(options.enqueue === undefined ? {} : { enqueue: options.enqueue }),
      ...(options.verify === undefined ? {} : { verify: options.verify }),
      ...(options.exportStorage === undefined
        ? {}
        : { exportStorage: () => options.exportStorage }),
      ...(options.enqueueExport === undefined ? {} : { enqueueExport: options.enqueueExport }),
      ...(options.enqueuePush === undefined ? {} : { enqueuePush: options.enqueuePush }),
    }),
  );
  app.use(
    '/api/contacts',
    createContactsRouter(options.verify === undefined ? {} : { verify: options.verify }),
  );
  app.use('/api/dashboard', createDashboardRouter());
  app.use('/api/suppressions', createSuppressionsRouter());
  // Le client R2 est construit au premier export volumineux : lire sa
  // configuration n'a pas a bloquer le demarrage.
  let stockage: { valeur: ExportStorage | undefined } | undefined =
    options.exportStorage === undefined ? undefined : { valeur: options.exportStorage };
  app.use(
    '/api/exports',
    createExportsRouter({
      storage: () => (stockage ??= { valeur: createR2Storage() }).valeur,
      enqueue: options.enqueueExport ?? enqueueExportBuild,
    }),
  );
  app.use('/api/verifications', createVerificationsRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
