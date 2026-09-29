import type { Router } from 'express';
import { z } from 'zod';
import { requireScope } from '../../api-keys/authenticate.js';
import { recordAuditEvent } from '../../audit/repository.js';
import { correctDomain, updateCompanySchema, updateCompany } from '../../companies/detail.js';
import { bulkCompanies } from '../../companies/fusion.js';
import { query } from '../../db/pool.js';
import { SHOWN_EMAIL } from '../../emails/visibility.js';
import { withUser } from '../../http/handler.js';
import { AppError } from '../../http/problem.js';
import { KNOWN_FIELDS } from '../../imports/fields.js';
import { planImport } from '../../imports/plan.js';
import { submitImport } from '../../imports/submit.js';
import type { Enqueue } from '../../pipeline/start.js';
import { enqueueImportPlan } from '../../queue/queues.js';
import { cursorCondition, cursorOrder, parsePageParams, toPage } from '../pagination.js';
import { apiSettingsSchema, reglages } from './imports.js';
import { pathId } from './params.js';
import { COMPANY_COLUMNS, emailsOfCompanies, type ApiCompany } from './serialize.js';

export const companyFiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  domain: z.string().trim().toLowerCase().max(253).optional(),
  city: z.string().trim().max(200).optional(),
  country: z.string().trim().max(100).optional(),
  industry: z.string().trim().max(200).optional(),
  tag: z.string().trim().toLowerCase().max(50).optional(),
  crawl_status: z.enum(['pending', 'running', 'done', 'failed', 'skipped']).optional(),
});

/** Les champs d'une entreprise creee par l'API : ceux d'une ligne d'import (6.2). */
const champ = z.string().trim().max(2000).optional();
export const companyCreationSchema = z
  .object({
    company_name: champ,
    domain: champ,
    website_url: champ,
    careers_url: champ,
    city: champ,
    country: champ,
    siren: champ,
    industry: champ,
    contact_name: champ,
    tags: z.array(z.string().max(50)).max(20).optional(),
    notes: z.string().max(5000).optional(),
    settings: apiSettingsSchema.optional(),
  })
  .strict();

async function entrepriseDuCompte(userId: string, brut: unknown): Promise<ApiCompany> {
  const id = pathId(brut);
  const lignes =
    id === undefined
      ? { rows: [] }
      : await query<ApiCompany>(
          `select ${COMPANY_COLUMNS} from companies c where c.id = $1 and c.user_id = $2`,
          [id, userId],
        );
  const entreprise = lignes.rows[0];
  if (entreprise === undefined) throw AppError.notFound("Cette entreprise n'existe pas.");
  return entreprise;
}

async function avecAdresses(userId: string, entreprise: ApiCompany) {
  const adresses = await emailsOfCompanies(userId, [entreprise.id]);
  return { ...entreprise, emails: adresses.get(entreprise.id) ?? [] };
}

export function registerCompanies(router: Router, enqueue: Enqueue): void {
  router.get(
    '/companies',
    requireScope('companies:read'),
    withUser(async (req, res, user) => {
      const { limit, cursor } = parsePageParams(req.query);
      const lu = companyFiltersSchema.safeParse(req.query);
      if (!lu.success) {
        throw AppError.badRequest('invalid_filter', 'Filtre refuse', lu.error.issues[0]?.message);
      }
      const f = lu.data;
      const valeurs: unknown[] = [user.id, cursor?.createdAt ?? null, cursor?.id ?? null];
      const conditions = ['c.user_id = $1', cursorCondition('c', 2, 3)];
      const ajouter = (sql: (n: string) => string, v: unknown) => {
        valeurs.push(v);
        conditions.push(sql(`$${String(valeurs.length)}`));
      };
      if (f.q !== undefined && f.q !== '') {
        ajouter(
          (n) => `(c.name ilike ${n} or c.domain ilike ${n})`,
          `%${f.q.replace(/[%_\\]/g, '\\$&')}%`,
        );
      }
      if (f.domain !== undefined) ajouter((n) => `c.domain = ${n}`, f.domain);
      if (f.city !== undefined) ajouter((n) => `lower(c.city) = lower(${n})`, f.city);
      if (f.country !== undefined) ajouter((n) => `lower(c.country) = lower(${n})`, f.country);
      if (f.industry !== undefined) ajouter((n) => `lower(c.industry) = lower(${n})`, f.industry);
      if (f.tag !== undefined) ajouter((n) => `${n} = any(c.tags)`, f.tag);
      if (f.crawl_status !== undefined) {
        ajouter((n) => `c.crawl_status = ${n}::crawl_status`, f.crawl_status);
      }
      valeurs.push(limit + 1);
      const lignes = await query<ApiCompany & { emails_count: number }>(
        `select ${COMPANY_COLUMNS},
                (select count(*)::int from emails e
                  where e.company_id = c.id and ${SHOWN_EMAIL}) as emails_count
           from companies c
          where ${conditions.join(' and ')}
          order by ${cursorOrder('c')}
          limit $${String(valeurs.length)}`,
        valeurs,
      );
      res.json(toPage(lignes.rows, limit, (c) => ({ createdAt: c.created_at, id: c.id })));
    }),
  );

  /**
   * Une entreprise creee par l'API passe par un import d'une ligne, planifie
   * sur-le-champ : memes regles de dedoublonnage qu'un fichier (F-303), et la
   * collecte part comme pour toute entreprise importee. Une entreprise deja
   * dans la bibliotheque est rendue telle quelle, en 200.
   */
  router.post(
    '/companies',
    requireScope('companies:write'),
    withUser(async (req, res, user) => {
      const lu = companyCreationSchema.safeParse(req.body);
      if (!lu.success) {
        throw AppError.badRequest(
          'invalid_company',
          'Entreprise refusee',
          lu.error.issues[0]?.message ?? 'Champs non reconnus.',
        );
      }
      const { settings, ...champs } = lu.data;
      const headers = KNOWN_FIELDS.filter((k) => champs[k] !== undefined);
      const resume = await submitImport(
        {
          userId: user.id,
          filename: "API : creation d'entreprise",
          headers,
          mapping: headers,
          rows: [
            headers.map((k) => {
              const v = champs[k];
              return Array.isArray(v) ? v.join(', ') : (v ?? '');
            }),
          ],
          settings: reglages(settings),
        },
        { enqueue: false },
      );
      const plan = await planImport(resume.id, user.id);
      // La tache ne fera plus que lancer la collecte : l'import est planifie.
      await enqueueImportPlan({ importId: resume.id, userId: user.id });

      const ligne = await query<{ company_id: string | null }>(
        'select company_id from import_rows where import_id = $1 and line = 2',
        [resume.id],
      );
      const entreprise = await entrepriseDuCompte(user.id, ligne.rows[0]?.company_id);
      const creee = plan.companiesCreated > 0;
      if (creee) {
        await recordAuditEvent({
          userId: user.id,
          action: 'company.created',
          entity: 'company',
          entityId: entreprise.id,
          metadata: { via: 'api', importId: resume.id },
        });
      }
      res.status(creee ? 201 : 200).json({
        company: await avecAdresses(user.id, entreprise),
        created: creee,
        import_id: resume.id,
      });
    }),
  );

  router.get(
    '/companies/:id',
    requireScope('companies:read'),
    withUser(async (req, res, user) => {
      const entreprise = await entrepriseDuCompte(user.id, req.params.id);
      res.json({ company: await avecAdresses(user.id, entreprise) });
    }),
  );

  router.patch(
    '/companies/:id',
    requireScope('companies:write'),
    withUser(async (req, res, user) => {
      const entreprise = await entrepriseDuCompte(user.id, req.params.id);
      const lu = updateCompanySchema.safeParse(req.body);
      if (!lu.success || Object.keys(lu.data).length === 0) {
        throw AppError.badRequest(
          'invalid_company',
          'Modification refusee',
          'Champs modifiables : name, city, country, industry, notes, tags.',
        );
      }
      await updateCompany(user.id, entreprise.id, lu.data);
      await recordAuditEvent({
        userId: user.id,
        action: 'company.updated',
        entity: 'company',
        entityId: entreprise.id,
        metadata: { fields: Object.keys(lu.data), via: 'api' },
      });
      res.json({
        company: await avecAdresses(user.id, await entrepriseDuCompte(user.id, entreprise.id)),
      });
    }),
  );

  /** R-05 : l'entreprise et ses adresses ; `?suppress=true` les ajoute a la liste de suppression. */
  router.delete(
    '/companies/:id',
    requireScope('companies:write'),
    withUser(async (req, res, user) => {
      const entreprise = await entrepriseDuCompte(user.id, req.params.id);
      const { suppressed } = await bulkCompanies(user.id, {
        action: 'delete',
        ids: [entreprise.id],
        suppress: req.query.suppress === 'true',
      });
      await recordAuditEvent({
        userId: user.id,
        action: 'company.deleted',
        entity: 'company',
        entityId: entreprise.id,
        metadata: { suppressed, via: 'api' },
      });
      res.json({ deleted: true, suppressed });
    }),
  );

  /** Relance la collecte sur le domaine actuel, historique compris (F-307). */
  router.post(
    '/companies/:id/enrich',
    requireScope('companies:write'),
    withUser(async (req, res, user) => {
      const entreprise = await entrepriseDuCompte(user.id, req.params.id);
      if (entreprise.domain === null) {
        throw new AppError({
          status: 409,
          code: 'domain_required',
          title: 'Domaine inconnu',
          detail: "Cette entreprise n'a pas encore de domaine : il n'y a pas de site a explorer.",
        });
      }
      const { importId } = await correctDomain(user.id, entreprise.id, entreprise.domain, enqueue);
      await recordAuditEvent({
        userId: user.id,
        action: 'company.recrawl_requested',
        entity: 'company',
        entityId: entreprise.id,
        metadata: { importId, via: 'api' },
      });
      res.status(202).json({ import_id: importId });
    }),
  );
}
