import { Router } from 'express';
import { getEnvironment } from '../config/env.js';
import { query } from '../db/pool.js';
import { SHOWN_EMAIL } from '../emails/visibility.js';
import { withUser } from '../http/handler.js';
import { requireAuth } from '../http/middleware/require-auth.js';
import { requireAcceptedTerms } from '../http/middleware/require-terms.js';

/**
 * Tableau de bord (F-1001) : entreprises, adresses par statut, imports en
 * cours avec leur progression reelle, credits du mois, derniers exports.
 * Tout vient de la base : aucun chiffre n'est estime.
 */

export interface CreditMeter {
  readonly provider: string;
  readonly operation: string;
  /** Ce que le compte a consomme ce mois, en unites de l'operation. */
  readonly used: number;
  readonly limit: number;
}

export function createDashboardRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireAcceptedTerms);

  router.get(
    '/',
    withUser(async (_req, res, user) => {
      const environment = getEnvironment();
      const [entreprises, statuts, imports, credits, exports] = await Promise.all([
        query<{ n: number }>('select count(*)::int as n from companies where user_id = $1', [
          user.id,
        ]),
        query<{ status: string; n: number }>(
          `select e.status::text as status, count(*)::int as n from emails e
            where e.user_id = $1 and ${SHOWN_EMAIL}
            group by e.status`,
          [user.id],
        ),
        query<{
          id: string;
          filename: string;
          status: string;
          created_at: Date;
          finished: number;
          total: number;
        }>(
          `select i.id, i.filename, i.status::text as status, i.created_at,
                  count(p.id) filter (where p.status in ('done', 'failed', 'skipped'))::int as finished,
                  count(p.id)::int as total
             from imports i
             left join pipeline_jobs p on p.import_id = i.id
            where i.user_id = $1 and i.status in ('pending', 'planning', 'running')
            group by i.id
            order by i.created_at desc
            limit 10`,
          [user.id],
        ),
        // Ce qui compte dans un plafond : ce qui a ete, ou a pu etre, paye.
        query<{ provider: string; operation: string; credits: string; calls: number }>(
          `select provider, operation, sum(credits)::text as credits, count(*)::int as calls
             from provider_calls
            where user_id = $1 and status in ('reserved', 'confirmed')
              and created_at >= date_trunc('month', now())
            group by provider, operation`,
          [user.id],
        ),
        query<{
          id: string;
          format: string;
          status: string;
          row_count: number | null;
          created_at: Date;
        }>(
          `select id, format, status::text as status, row_count, created_at from exports
            where user_id = $1 order by created_at desc limit 5`,
          [user.id],
        ),
      ]);

      const consomme = (provider: string, operation: string) =>
        credits.rows.find((c) => c.provider === provider && c.operation === operation);
      // Les plafonds par compte de D-14, dans l'unite que l'utilisateur comprend :
      // des recherches et des verifications, pas des credits.
      const compteurs: CreditMeter[] = [
        {
          provider: 'brave',
          operation: 'web_search',
          used: consomme('brave', 'web_search')?.calls ?? 0,
          limit: environment.QUOTA_WEB_SEARCHES_PER_USER_PER_MONTH,
        },
        {
          provider: 'hunter',
          operation: 'domain_search',
          used: consomme('hunter', 'domain_search')?.calls ?? 0,
          limit: environment.QUOTA_PROVIDER_SEARCHES_PER_USER_PER_MONTH,
        },
        {
          provider: 'hunter',
          operation: 'verification',
          used: consomme('hunter', 'verification')?.calls ?? 0,
          limit: environment.QUOTA_MAILBOX_VERIFICATIONS_PER_USER_PER_MONTH,
        },
      ];

      res.json({
        companies: entreprises.rows[0]?.n ?? 0,
        emailsByStatus: Object.fromEntries(statuts.rows.map((s) => [s.status, s.n])),
        importsInProgress: imports.rows.map((i) => ({
          id: i.id,
          filename: i.filename,
          status: i.status,
          createdAt: i.created_at,
          finishedSteps: i.finished,
          totalSteps: i.total,
        })),
        credits: compteurs,
        recentExports: exports.rows.map((e) => ({
          id: e.id,
          format: e.format,
          status: e.status,
          rowCount: e.row_count,
          createdAt: e.created_at,
        })),
      });
    }),
  );

  return router;
}
