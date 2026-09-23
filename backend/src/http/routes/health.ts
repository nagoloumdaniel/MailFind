import { Router } from 'express';
import { APP_VERSION } from '../../app-info.js';

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
