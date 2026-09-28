import { query } from '../db/pool.js';
import { likePattern } from '../contacts/query.js';
import { COMPANY_SORT_EXPRESSIONS, type CompanyQuery } from './query.js';

export interface CompanySummary {
  readonly id: string;
  readonly name: string;
  readonly domain: string | null;
  readonly domainStatus: string;
  readonly city: string | null;
  readonly country: string | null;
  readonly industry: string | null;
  readonly tags: readonly string[];
  readonly crawlStatus: string;
  readonly emailCount: number;
  readonly validCount: number;
  /** Les types des adresses de l'entreprise, sans doublon. */
  readonly types: readonly string[];
  readonly bestScore: number | null;
  readonly createdAt: Date;
}

/**
 * Le resume des adresses par entreprise. Une candidate que la verification a
 * refusee n'y compte pas (F-503).
 */
const ADRESSES = `
  left join lateral (
    select count(*)::int as total,
           count(*) filter (where e.status = 'valid')::int as valides,
           array_agg(distinct e.type::text) as types,
           max(e.score) as best_score
      from emails e
     where e.company_id = c.id and not (e.origin = 'deduced' and e.excluded)
  ) a on true`;

function conditions(userId: string, filtre: CompanyQuery): { where: string; params: unknown[] } {
  const params: unknown[] = [userId];
  const parties = ['c.user_id = $1'];
  const ajouter = (sql: (n: string) => string, valeur: unknown) => {
    params.push(valeur);
    parties.push(sql(`$${String(params.length)}`));
  };

  if (filtre.q !== '') {
    ajouter(
      (n) =>
        `(c.name ilike ${n} or c.legal_name ilike ${n} or c.domain ilike ${n}
          or c.city ilike ${n} or c.siren ilike ${n})`,
      likePattern(filtre.q.toLowerCase()),
    );
  }
  if (filtre.city) ajouter((n) => `lower(c.city) = lower(${n})`, filtre.city);
  if (filtre.country) ajouter((n) => `lower(c.country) = lower(${n})`, filtre.country);
  if (filtre.industry) ajouter((n) => `lower(c.industry) = lower(${n})`, filtre.industry);
  if (filtre.tag) ajouter((n) => `${n} = any(c.tags)`, filtre.tag.toLowerCase());
  if (filtre.crawlStatus.length > 0) {
    ajouter((n) => `c.crawl_status::text = any(${n}::text[])`, filtre.crawlStatus);
  }
  for (const type of filtre.hasType) {
    ajouter(
      (n) =>
        `exists (select 1 from emails e where e.company_id = c.id and e.type::text = ${n}
                   and not (e.origin = 'deduced' and e.excluded))`,
      type,
    );
  }
  return { where: parties.join(' and '), params };
}

export async function listCompanies(
  userId: string,
  filtre: CompanyQuery,
): Promise<{ total: number; companies: CompanySummary[] }> {
  const { where, params } = conditions(userId, filtre);
  const total = await query<{ n: number }>(
    `select count(*)::int as n from companies c where ${where}`,
    params,
  );
  const sens = filtre.dir === 'desc' ? 'desc' : 'asc';
  const lignes = await query<{
    id: string;
    name: string;
    domain: string | null;
    domain_status: string;
    city: string | null;
    country: string | null;
    industry: string | null;
    tags: string[];
    crawl_status: string;
    total: number | null;
    valides: number | null;
    types: (string | null)[] | null;
    best_score: number | null;
    created_at: Date;
  }>(
    `select c.id, c.name, c.domain, c.domain_status::text as domain_status, c.city, c.country,
            c.industry, c.tags, c.crawl_status::text as crawl_status, a.total, a.valides,
            a.types, a.best_score, c.created_at
       from companies c ${ADRESSES}
      where ${where}
      order by ${COMPANY_SORT_EXPRESSIONS[filtre.sort]} ${sens} nulls last, c.id ${sens}
      limit $${String(params.length + 1)} offset $${String(params.length + 2)}`,
    [...params, filtre.pageSize, (filtre.page - 1) * filtre.pageSize],
  );
  return {
    total: total.rows[0]?.n ?? 0,
    companies: lignes.rows.map((ligne) => ({
      id: ligne.id,
      name: ligne.name,
      domain: ligne.domain,
      domainStatus: ligne.domain_status,
      city: ligne.city,
      country: ligne.country,
      industry: ligne.industry,
      tags: ligne.tags,
      crawlStatus: ligne.crawl_status,
      emailCount: ligne.total ?? 0,
      validCount: ligne.valides ?? 0,
      types: (ligne.types ?? []).filter((type): type is string => type !== null),
      bestScore: ligne.best_score,
      createdAt: ligne.created_at,
    })),
  };
}

/** Les valeurs connues des filtres, pour les proposer plutot que les faire taper. */
export async function companyFacets(userId: string): Promise<{
  cities: string[];
  countries: string[];
  industries: string[];
  tags: string[];
}> {
  const lire = async (sql: string) =>
    (await query<{ v: string }>(sql, [userId])).rows.map((ligne) => ligne.v);
  // Une valeur sans tenir compte de la casse : « Lyon » et « lyon » sont la
  // meme ville, et le filtre les retrouve toutes deux. L'orthographe la plus
  // frequente la represente.
  const distinctes = (colonne: string) =>
    lire(`select mode() within group (order by ${colonne}) as v from companies
           where user_id = $1 and nullif(${colonne}, '') is not null
           group by lower(${colonne}) order by lower(${colonne}) limit 200`);
  const [cities, countries, industries, tags] = await Promise.all([
    distinctes('city'),
    distinctes('country'),
    distinctes('industry'),
    lire(
      `select distinct unnest(tags) as v from companies where user_id = $1 order by 1 limit 200`,
    ),
  ]);
  return { cities, countries, industries, tags };
}
