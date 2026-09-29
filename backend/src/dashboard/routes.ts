import { Router } from 'express';
import { query } from '../db/pool.js';
import { SHOWN_EMAIL } from '../emails/visibility.js';
import { withUser } from '../http/handler.js';
import { requireAuth } from '../http/middleware/require-auth.js';
import { requireAcceptedTerms } from '../http/middleware/require-terms.js';
import { monthlyUsage } from '../providers/usage.js';

/**
 * Tableau de bord (F-1001) : entreprises, adresses par statut, imports en
 * cours avec leur progression reelle, credits du mois, derniers exports.
 * Tout vient de la base : aucun chiffre n'est estime.
 */

export type { CreditMeter } from '../providers/usage.js';

export function createDashboardRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireAcceptedTerms);

  router.get(
    '/',
    withUser(async (_req, res, user) => {
      const [entreprises, statuts, imports, compteurs, exports] = await Promise.all([
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
        monthlyUsage(user.id),
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
