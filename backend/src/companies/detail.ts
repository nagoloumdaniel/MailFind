import { z } from 'zod';
import { getPool, query } from '../db/pool.js';
import { AppError } from '../http/problem.js';
import { importSettingsSchema, readStoredSettings } from '../imports/settings.js';
import type { Enqueue } from '../pipeline/start.js';
import { planStep } from '../pipeline/steps.js';
import { normalizeDomain, normalizeTags } from './normalize.js';
import { SHOWN_EMAIL } from '../emails/visibility.js';

/**
 * Fiche entreprise (F-1004) : identite, adresses par type avec toutes leurs
 * sources, canaux alternatifs, historique des traitements, notes ; et la
 * correction du domaine, qui relance la collecte sur le bon site (F-307).
 */

export interface CompanyDetail {
  readonly id: string;
  readonly name: string;
  readonly legalName: string | null;
  readonly domain: string | null;
  readonly domainStatus: string;
  readonly domainConfidence: number | null;
  readonly websiteUrl: string | null;
  readonly careersUrl: string | null;
  readonly contactFormUrl: string | null;
  readonly linkedinUrl: string | null;
  readonly phone: string | null;
  readonly siren: string | null;
  readonly city: string | null;
  readonly country: string | null;
  readonly industry: string | null;
  readonly employeeRange: string | null;
  readonly tags: readonly string[];
  readonly notes: string | null;
  readonly crawlStatus: string;
  readonly crawlNotes: readonly string[];
  readonly crawlError: string | null;
  readonly crawledAt: Date | null;
  readonly createdAt: Date;
}

export interface CompanyEmail {
  readonly id: string;
  readonly address: string;
  readonly contactName: string | null;
  readonly type: string;
  readonly origin: string;
  readonly status: string;
  readonly score: number | null;
  readonly scoreBreakdown: unknown;
  readonly verificationReason: string | null;
  readonly verifiedAt: Date | null;
  readonly sources: readonly {
    readonly kind: string;
    readonly url: string | null;
    readonly provider: string | null;
    readonly method: string | null;
    readonly excerpt: string | null;
    readonly discoveredAt: Date;
  }[];
}

export interface CompanyHistoryEntry {
  readonly importId: string | null;
  readonly filename: string | null;
  readonly step: string;
  readonly status: string;
  readonly error: string | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly createdAt: Date;
}

export async function getCompanyDetail(
  userId: string,
  id: string,
): Promise<
  { company: CompanyDetail; emails: CompanyEmail[]; history: CompanyHistoryEntry[] } | undefined
> {
  const lue = await query<Record<string, unknown>>(
    `select id, name, legal_name, domain, domain_status::text as domain_status, domain_confidence,
            website_url, careers_url, contact_form_url, linkedin_url, phone, siren, city,
            country, industry, employee_range, tags, notes, crawl_status::text as crawl_status,
            crawl_notes::text[] as crawl_notes, crawl_error, crawled_at, created_at
       from companies where id = $1 and user_id = $2`,
    [id, userId],
  );
  const c = lue.rows[0];
  if (c === undefined) return undefined;

  const emails = await query<{
    id: string;
    address: string;
    contact_name: string | null;
    type: string;
    origin: string;
    status: string;
    score: number | null;
    score_breakdown: unknown;
    reason: string | null;
    verified_at: Date | null;
    sources: CompanyEmail['sources'] | null;
  }>(
    `select e.id, e.address, e.contact_name, e.type::text as type, e.origin::text as origin,
            e.status::text as status, e.score, e.score_breakdown, v.reason,
            e.last_verified_at as verified_at,
            (select json_agg(json_build_object(
                      'kind', s.kind, 'url', s.url, 'provider', s.provider,
                      'method', s.extraction_method, 'excerpt', s.context_excerpt,
                      'discoveredAt', s.discovered_at) order by s.discovered_at)
               from email_sources s where s.email_id = e.id) as sources
       from emails e
       left join lateral (
         select reason from verifications
          where email_id = e.id order by verified_at desc, level desc limit 1
       ) v on true
      where e.company_id = $1 and e.user_id = $2
        and ${SHOWN_EMAIL}
      order by array_position(array['recruitment', 'hr', 'generic', 'sales', 'press',
                                    'support', 'personal', 'unknown'], e.type::text),
               e.score desc nulls last, e.normalized_address`,
    [id, userId],
  );

  const historique = await query<{
    import_id: string | null;
    filename: string | null;
    step: string;
    status: string;
    error: string | null;
    started_at: Date | null;
    completed_at: Date | null;
    created_at: Date;
  }>(
    `select p.import_id, i.filename, p.step::text as step, p.status::text as status, p.error,
            p.started_at, p.completed_at, p.created_at
       from pipeline_jobs p
       left join imports i on i.id = p.import_id
      where p.company_id = $1
      order by p.created_at desc
      limit 100`,
    [id],
  );

  const texte = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    company: {
      id: String(c.id),
      name: String(c.name),
      legalName: texte(c.legal_name),
      domain: texte(c.domain),
      domainStatus: String(c.domain_status),
      domainConfidence: typeof c.domain_confidence === 'number' ? c.domain_confidence : null,
      websiteUrl: texte(c.website_url),
      careersUrl: texte(c.careers_url),
      contactFormUrl: texte(c.contact_form_url),
      linkedinUrl: texte(c.linkedin_url),
      phone: texte(c.phone),
      siren: texte(c.siren),
      city: texte(c.city),
      country: texte(c.country),
      industry: texte(c.industry),
      employeeRange: texte(c.employee_range),
      tags: Array.isArray(c.tags) ? (c.tags as string[]) : [],
      notes: texte(c.notes),
      crawlStatus: String(c.crawl_status),
      crawlNotes: Array.isArray(c.crawl_notes) ? (c.crawl_notes as string[]) : [],
      crawlError: texte(c.crawl_error),
      crawledAt: c.crawled_at instanceof Date ? c.crawled_at : null,
      createdAt: c.created_at as Date,
    },
    emails: emails.rows.map((e) => ({
      id: e.id,
      address: e.address,
      contactName: e.contact_name,
      type: e.type,
      origin: e.origin,
      status: e.status,
      score: e.score,
      scoreBreakdown: e.score_breakdown,
      verificationReason: e.reason,
      verifiedAt: e.verified_at,
      sources: e.sources ?? [],
    })),
    history: historique.rows.map((h) => ({
      importId: h.import_id,
      filename: h.filename,
      step: h.step,
      status: h.status,
      error: h.error,
      startedAt: h.started_at,
      completedAt: h.completed_at,
      createdAt: h.created_at,
    })),
  };
}

const texteLibre = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v));

export const updateCompanySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    city: texteLibre(200),
    country: texteLibre(100),
    industry: texteLibre(200),
    notes: texteLibre(5000),
    tags: z.array(z.string().max(50)).max(20).optional(),
  })
  .strict();

export async function updateCompany(
  userId: string,
  id: string,
  input: z.infer<typeof updateCompanySchema>,
): Promise<boolean> {
  const affectations: string[] = [];
  const valeurs: unknown[] = [id, userId];
  const poser = (colonne: string, valeur: unknown) => {
    valeurs.push(valeur);
    affectations.push(`${colonne} = $${String(valeurs.length)}`);
  };
  // Le nom affiche change, pas le nom reduit qui sert au dedoublonnage : il
  // reste celui sous lequel l'entreprise a ete reconnue.
  if (input.name !== undefined) poser('name', input.name);
  if (input.city !== undefined) poser('city', input.city);
  if (input.country !== undefined) poser('country', input.country);
  if (input.industry !== undefined) poser('industry', input.industry);
  if (input.notes !== undefined) poser('notes', input.notes);
  if (input.tags !== undefined) poser('tags', normalizeTags(input.tags.join(',')));
  const resultat = await query(
    `update companies set ${[...affectations, 'updated_at = now()'].join(', ')}
      where id = $1 and user_id = $2`,
    valeurs,
  );
  return (resultat.rowCount ?? 0) > 0;
}

/**
 * F-307 : l'utilisateur corrige le domaine, et la collecte repart sur le bon
 * site. La relance passe par un import d'une ligne, « Correction du domaine » :
 * le pipeline lit ses reglages dans un import, et l'historique de
 * l'entreprise garde la trace de la correction comme de tout traitement.
 */
export async function correctDomain(
  userId: string,
  id: string,
  saisie: string,
  enqueue: Enqueue,
): Promise<{ importId: string }> {
  const domaine = normalizeDomain(saisie);
  if (domaine === undefined) {
    throw AppError.badRequest(
      'invalid_domain',
      'Domaine refuse',
      "Ce domaine n'est pas exploitable.",
    );
  }
  const lue = await query<{ name: string; settings: unknown }>(
    `select c.name,
            (select i.settings from import_rows r join imports i on i.id = r.import_id
              where r.company_id = c.id order by i.created_at desc limit 1) as settings
       from companies c where c.id = $1 and c.user_id = $2`,
    [id, userId],
  );
  const entreprise = lue.rows[0];
  if (entreprise === undefined) throw AppError.notFound("Cette entreprise n'existe pas.");
  const reglages =
    entreprise.settings === null
      ? importSettingsSchema.parse({})
      : readStoredSettings(entreprise.settings);

  const client = await getPool().connect();
  let importId: string;
  try {
    await client.query('begin');
    try {
      await client.query(
        `update companies
            set domain = $3, domain_status = 'confirmed', domain_confidence = null,
                website_url = $4, crawl_status = 'pending', crawled_at = null,
                crawl_error = null, crawl_notes = '{}', updated_at = now()
          where id = $1 and user_id = $2`,
        [id, userId, domaine, `https://${domaine}/`],
      );
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        throw new AppError({
          status: 409,
          code: 'domain_taken',
          title: 'Domaine deja utilise',
          detail:
            'Une autre entreprise de votre bibliotheque a deja ce domaine. Fusionnez les deux fiches plutot que de les garder en double.',
        });
      }
      throw error;
    }
    const cree = await client.query<{ id: string }>(
      `insert into imports (user_id, filename, settings, total_rows, processed_rows, status,
                            started_at)
       values ($1, $2, $3, 1, 1, 'running', now()) returning id`,
      [
        userId,
        `Correction du domaine : ${entreprise.name}`.slice(0, 200),
        JSON.stringify(reglages),
      ],
    );
    importId = cree.rows[0]?.id ?? '';
    await client.query(
      `insert into import_rows (import_id, line, raw, company_id, status)
       values ($1, 1, $2, $3, 'accepted')`,
      [importId, JSON.stringify({ company_name: entreprise.name, domain: domaine }), id],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const job = { importId, companyId: id, userId };
  await planStep('crawl', job);
  await enqueue('crawl', job);
  return { importId };
}
