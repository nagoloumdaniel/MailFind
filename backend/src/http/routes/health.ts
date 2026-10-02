import { Router } from 'express';
import { APP_VERSION } from '../../app-info.js';
import { getEnvironment } from '../../config/env.js';
import { checkReadiness } from '../../observability/readiness.js';

export const healthRouter: Router = Router();

/**
 * « Le processus repond » (section 12). Rien d'autre : aucune dependance n'est
 * interrogee ici, sinon l'hebergeur redemarrerait l'API parce que la base est
 * lente. L'etat des dependances est le role de `/ready`, qui arrive avec
 * elles.
 */
healthRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: APP_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

/**
 * « Les dependances repondent, et le travail avance » (section 12). Sans
 * session : une sonde n'a pas de compte, et le rapport ne dit rien de
 * personne, seulement des compteurs.
 *
 * 503 quand une dependance est muette, pour qu'une sonde le voie sans lire le
 * corps.
 */
healthRouter.get('/ready', (_req, res, next) => {
  void (async () => {
    try {
      const rapport = await checkReadiness(getEnvironment().BULLMQ_PREFIX);
      res.status(rapport.ready ? 200 : 503).json(rapport);
    } catch (error) {
      next(error);
    }
  })();
});
