import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { likePattern } from '../contacts/query.js';
import { withUser } from '../http/handler.js';
import { requireAuth } from '../http/middleware/require-auth.js';
import { requireAcceptedTerms } from '../http/middleware/require-terms.js';
import { AppError } from '../http/problem.js';
import { companyFacets, listCompanies } from './list.js';
import { recordAuditEvent } from '../audit/repository.js';
import type { Enqueue } from '../pipeline/start.js';
import { enqueueCompanyStep } from '../queue/queues.js';
import { correctDomain, getCompanyDetail, updateCompany, updateCompanySchema } from './detail.js';
import { bulkCompanies, bulkCompaniesSchema, mergeCompanies, mergeSchema } from './fusion.js';
import type { VerifyDeps } from '../pipeline/verify.js';
import { createVerifyDeps } from '../pipeline/verify-deps.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const domaineSchema = z.object({ domain: z.string().trim().min(1).max(253) }).strict();

function identifiant(valeur: unknown): string {
  const id = typeof valeur === 'string' ? valeur : '';
  // 404 et non 400 : une entreprise d'un autre compte n'existe pas (S-04).
  if (!UUID.test(id)) throw AppError.notFound("Cette entreprise n'existe pas.");
  return id;
}
import { companyQuerySchema } from './query.js';

const rechercheSchema = z.object({ q: z.string().trim().max(200).optional().default('') });

export function createCompaniesRouter(
  options: { enqueue?: Enqueue; verify?: VerifyDeps } = {},
): Router {
  const enqueue = options.enqueue ?? enqueueCompanyStep;
  let verification = options.verify;
  const deps = () => (verification ??= createVerifyDeps());
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

  router.post(
    '/merge',
    withUser(async (req, res, user) => {
      const lu = mergeSchema.safeParse(req.body);
      if (!lu.success) {
        throw AppError.badRequest(
          'invalid_merge',
          'Fusion refusee',
          lu.error.issues[0]?.code === 'custom'
            ? lu.error.issues[0].message
            : 'Choisissez deux entreprises.',
        );
      }
      await mergeCompanies(deps(), user.id, lu.data.targetId, lu.data.sourceId);
      await recordAuditEvent({
        userId: user.id,
        action: 'company.merged',
        entity: 'company',
        entityId: lu.data.targetId,
        metadata: { mergedFrom: lu.data.sourceId },
      });
      res.json(await getCompanyDetail(user.id, lu.data.targetId));
    }),
  );

  router.post(
    '/bulk',
    withUser(async (req, res, user) => {
      const lu = bulkCompaniesSchema.safeParse(req.body);
      if (!lu.success) {
        throw AppError.badRequest(
          'invalid_bulk_action',
          'Action refusee',
          'Action inconnue, ou selection de plus de 1 000 entreprises.',
        );
      }
      const resultat = await bulkCompanies(user.id, lu.data);
      await recordAuditEvent({
        userId: user.id,
        action: 'company.updated',
        entity: 'company',
        entityId: null,
        metadata: { bulk: lu.data.action, requested: lu.data.ids.length, ...resultat },
      });
      res.json(resultat);
    }),
  );

  router.get(
    '/:id',
    withUser(async (req, res, user) => {
      const fiche = await getCompanyDetail(user.id, identifiant(req.params.id));
      if (fiche === undefined) throw AppError.notFound("Cette entreprise n'existe pas.");
      res.json(fiche);
    }),
  );

  router.patch(
    '/:id',
    withUser(async (req, res, user) => {
      const id = identifiant(req.params.id);
      const lu = updateCompanySchema.safeParse(req.body);
      if (!lu.success) {
        throw AppError.badRequest(
          'invalid_company',
          'Modification refusee',
          'Un champ est invalide.',
        );
      }
      if (!(await updateCompany(user.id, id, lu.data))) {
        throw AppError.notFound("Cette entreprise n'existe pas.");
      }
      await recordAuditEvent({
        userId: user.id,
        action: 'company.updated',
        entity: 'company',
        entityId: id,
        metadata: { fields: Object.keys(lu.data) },
      });
      res.json(await getCompanyDetail(user.id, id));
    }),
  );

  router.post(
    '/:id/domain',
    withUser(async (req, res, user) => {
      const id = identifiant(req.params.id);
      const lu = domaineSchema.safeParse(req.body);
      if (!lu.success) {
        throw AppError.badRequest('invalid_domain', 'Domaine refuse', 'Indiquez un domaine.');
      }
      const { importId } = await correctDomain(user.id, id, lu.data.domain, enqueue);
      await recordAuditEvent({
        userId: user.id,
        action: 'company.domain_corrected',
        entity: 'company',
        entityId: id,
        metadata: { importId },
      });
      res.status(202).json({ importId, ...(await getCompanyDetail(user.id, id)) });
    }),
  );

  return router;
}
