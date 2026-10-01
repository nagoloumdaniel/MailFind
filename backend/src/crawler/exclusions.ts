import { query } from '../db/pool.js';

/**
 * Sites ayant demande a ne pas etre explores (R-07, F-1603).
 *
 * Une demande s'applique des sa reception, avant toute revue : respecter un
 * refus ne doit pas attendre qu'un humain ait le temps. L'exploitant peut la
 * refuser ensuite, si elle se revele infondee.
 *
 * L'exclusion vaut pour le domaine et ses sous-domaines : un site qui dit
 * non ne dit pas oui pour `www.` ou `carrieres.`.
 */

/** Le domaine tel qu'on le compare : minuscules, sans `www.`, sans point final. */
export function normalizeDomain(brut: string): string {
  return brut
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]!
    .split(':')[0]!;
}

/** Vrai quand le domaine, ou le site qui le porte, a demande a etre laisse. */
export async function isDomainExcluded(domain: string): Promise<boolean> {
  const normalise = normalizeDomain(domain);
  if (normalise === '') return false;

  // `d = $1 or $1 se termine par .d` : l'exclusion de `acme.fr` couvre
  // `carrieres.acme.fr`, sans couvrir `faux-acme.fr`.
  const result = await query<{ exclu: boolean }>(
    `select true as exclu from excluded_domains
      where status <> 'rejected'
        and ($1 = domain or $1 like '%.' || domain)
      limit 1`,
    [normalise],
  );
  return result.rows.length > 0;
}

export type ExclusionOutcome = 'recorded' | 'already_known';

/** Enregistre une demande venue de la page publique. Rejouable sans effet. */
export async function requestExclusion(domain: string, reason?: string): Promise<ExclusionOutcome> {
  const normalise = normalizeDomain(domain);
  const issue = await query(
    `insert into excluded_domains (domain, reason) values ($1, $2)
     on conflict (domain) do nothing`,
    [normalise, reason?.slice(0, 500) ?? null],
  );
  return (issue.rowCount ?? 0) > 0 ? 'recorded' : 'already_known';
}

export interface ExcludedDomain {
  readonly domain: string;
  readonly status: 'pending' | 'confirmed' | 'rejected';
  readonly reason: string | null;
  readonly createdAt: string;
}

export async function listExcludedDomains(): Promise<ExcludedDomain[]> {
  const result = await query<{
    domain: string;
    status: ExcludedDomain['status'];
    reason: string | null;
    created_at: Date;
  }>(
    `select domain, status::text as status, reason, created_at
       from excluded_domains order by created_at desc limit 500`,
  );
  return result.rows.map((ligne) => ({
    domain: ligne.domain,
    status: ligne.status,
    reason: ligne.reason,
    createdAt: ligne.created_at.toISOString(),
  }));
}
