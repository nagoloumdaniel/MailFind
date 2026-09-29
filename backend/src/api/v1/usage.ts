import type { Router } from 'express';
import { withUser } from '../../http/handler.js';
import { monthlyUsage } from '../../providers/usage.js';

/**
 * Consommation du mois (F-1309) : les memes compteurs que le tableau de bord,
 * parce que l'API et l'interface puisent dans les memes quotas. Lisible avec
 * n'importe quelle portee : c'est ce qu'une application doit savoir avant
 * d'en consommer.
 */
export function registerUsage(router: Router): void {
  router.get(
    '/usage',
    withUser(async (_req, res, user) => {
      const maintenant = new Date();
      const debut = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1));
      const fin = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() + 1, 1));
      const compteurs = await monthlyUsage(user.id);
      res.json({
        period: { start: debut.toISOString(), end: fin.toISOString() },
        meters: compteurs.map((c) => ({
          provider: c.provider,
          operation: c.operation,
          used: c.used,
          limit: c.limit,
          remaining: Math.max(0, c.limit - c.used),
        })),
      });
    }),
  );
}
