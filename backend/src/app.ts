import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import passport from 'passport';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { createAccountRouter } from './account/routes.js';
import { createAuthRouter } from './auth/routes.js';
import { createSessionMiddleware } from './auth/session.js';
import { getEnvironment } from './config/env.js';
import { getLogger } from './observability/logger.js';
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
  // client vue par l'API est celle du proxy, ce qui fausserait plus tard la
  // limitation de debit.
  app.set('trust proxy', 1);

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

  app.use(express.json({ limit: '1mb' }));

  // Avant toute route : `/health` n'a pas besoin de session, mais la poser ici
  // garde un seul ordre de middlewares a comprendre.
  app.use(options.session ?? createSessionMiddleware());
  app.use(passport.initialize());
  app.use(csrfProtection);

  app.use(healthRouter);
  app.use('/api/auth', createAuthRouter());
  app.use('/api/account', createAccountRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
