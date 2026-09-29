import { query } from '../../db/pool.js';
import { SHOWN_EMAIL } from '../../emails/visibility.js';
import type { ImportProgress, ImportSummary, StepCounts } from '../../imports/repository.js';

/**
 * Ce que l'API publique rend, en snake_case comme l'annexe C du cahier des
 * charges. Une forme a part de celle de l'interface : un client d'API s'y
 * fie, elle ne change pas quand une page change.
 */

export interface ApiSource {
  readonly kind: string;
  readonly url: string | null;
  readonly provider: string | null;
  readonly discovered_at: string;
}

export interface ApiEmail {
  readonly id: string;
  readonly company_id: string;
  readonly address: string;
  readonly contact_name: string | null;
  readonly type: string;
  readonly origin: string;
  readonly status: string;
  readonly score: number | null;
  readonly verified_at: Date | null;
  readonly excluded: boolean;
  readonly tags: readonly string[];
  readonly created_at: Date;
  readonly sources: readonly ApiSource[];
}

export const EMAIL_COLUMNS = `
  e.id, e.company_id, e.address, e.contact_name, e.type::text as type, e.origin::text as origin,
  e.status::text as status, e.score, e.last_verified_at as verified_at, e.excluded, e.tags,
  e.created_at,
  coalesce((select json_agg(json_build_object(
              'kind', s.kind, 'url', s.url, 'provider', s.provider,
              'discovered_at', s.discovered_at) order by s.discovered_at)
              from email_sources s where s.email_id = e.id), '[]'::json) as sources`;

/**
 * Les adresses visibles de plusieurs entreprises, en une requete, rangees
 * par entreprise puis par score : la meilleure adresse d'abord.
 */
export async function emailsOfCompanies(
  userId: string,
  companyIds: readonly string[],
): Promise<Map<string, ApiEmail[]>> {
  const parEntreprise = new Map<string, ApiEmail[]>(companyIds.map((id) => [id, []]));
  if (companyIds.length === 0) return parEntreprise;
  const lignes = await query<ApiEmail>(
    `select ${EMAIL_COLUMNS}
       from emails e
      where e.user_id = $1 and e.company_id = any($2::uuid[]) and ${SHOWN_EMAIL}
      order by e.company_id, e.score desc nulls last, e.address`,
    [userId, companyIds],
  );
  for (const ligne of lignes.rows) parEntreprise.get(ligne.company_id)?.push(ligne);
  return parEntreprise;
}

export interface ApiCompany {
  readonly id: string;
  readonly name: string;
  readonly legal_name: string | null;
  readonly domain: string | null;
  readonly domain_status: string;
  readonly website_url: string | null;
  readonly careers_url: string | null;
  readonly contact_form_url: string | null;
  readonly siren: string | null;
  readonly city: string | null;
  readonly country: string | null;
  readonly industry: string | null;
  readonly tags: readonly string[];
  readonly crawl_status: string;
  readonly created_at: Date;
}

export const COMPANY_COLUMNS = `
  c.id, c.name, c.legal_name, c.domain, c.domain_status::text as domain_status, c.website_url,
  c.careers_url, c.contact_form_url, c.siren, c.city, c.country, c.industry, c.tags,
  c.crawl_status::text as crawl_status, c.created_at`;

export function serializeImport(resume: ImportSummary) {
  return {
    id: resume.id,
    name: resume.filename,
    status: resume.status,
    total_rows: resume.totalRows,
    processed_rows: resume.processedRows,
    accepted_rows: resume.acceptedRows,
    duplicate_rows: resume.duplicateRows,
    rejected_rows: resume.rejectedRows,
    error: resume.error,
    created_at: resume.createdAt,
    completed_at: resume.completedAt,
  };
}

function etape(compte: StepCounts) {
  return {
    pending: compte.pending,
    running: compte.running,
    done: compte.done,
    failed: compte.failed,
    skipped: compte.skipped,
  };
}

export function serializeProgress(progression: ImportProgress) {
  return {
    companies: progression.companies,
    steps: {
      identify: etape(progression.identify),
      crawl: etape(progression.crawl),
      enrich: etape(progression.enrich),
      verify: etape(progression.verify),
    },
    emails: progression.emails,
    emails_by_status: progression.emailsByStatus,
  };
}
