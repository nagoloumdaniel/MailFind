import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { likePattern } from '../contacts/query.js';
import { withUser } from '../http/handler.js';
import { requireAuth } from '../http/middleware/require-auth.js';
import { requireAcceptedTerms } from '../http/middleware/require-terms.js';
import { AppError } from '../http/problem.js';
import { companyFacets, listCompanies } from './list.js';
import { companyQuerySchema } from './query.js';

const rechercheSchema = z.object({ q: z.string().trim().max(200).optional().default('') });

export function createCompaniesRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireAcceptedTerms);

  router.get(
    '/',
    withUser(async (req, res, user) => {
      const lu = companyQuerySchema.safeParse(req.query);
      if (!lu.success) {
        throw AppError.badRequest(
          'invalid_company_query',
          'Recherche refusee',
          "Un tri, un filtre ou une taille de page n'est pas reconnu.",
        );
      }
      const { total, companies } = await listCompanies(user.id, lu.data);
      res.json({ total, page: lu.data.page, pageSize: lu.data.pageSize, companies });
    }),
  );

  router.get(
    '/facets',
    withUser(async (_req, res, user) => {
      res.json(await companyFacets(user.id));
    }),
  );

  /** Quelques entreprises par nom ou domaine, pour choisir celle d'un contact. */
  router.get(
    '/lookup',
    withUser(async (req, res, user) => {
      const { q } = rechercheSchema.parse(req.query);
      const lues = await query<{ id: string; name: string; domain: string | null }>(
        `select id, name, domain from companies
          where user_id = $1 and ($2 = '' or name ilike $3 or domain ilike $3)
          order by lower(name), id
          limit 10`,
        [user.id, q, likePattern(q.toLowerCase())],
      );
      res.json({ companies: lues.rows });
    }),
  );

  return router;
}
