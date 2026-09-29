import { query } from '../db/pool.js';
import { EXPORTED_STATUSES, type ExportRequest } from './request.js';

/**
 * Ce qu'un export contient, charge une fois pour tous les formats. Les
 * adresses gardent toujours le lien avec leur entreprise (6.11), et chacune
 * a au moins une source : la base refuse une adresse sans source, et la
 * requete ne peut donc rien rendre d'autre (A4).
 */

export interface ExportSource {
  readonly kind: string;
  readonly url: string | null;
  readonly provider: string | null;
  readonly method: string | null;
  readonly excerpt: string | null;
  readonly discoveredAt: string;
}

export interface ExportEmail {
  readonly id: string;
  readonly address: string;
  readonly contactName: string | null;
  readonly salutation: string | null;
  readonly type: string;
  readonly origin: string;
  readonly status: string;
  readonly score: number | null;
  readonly tags: readonly string[];
  readonly verificationReason: string | null;
  readonly verifiedAt: Date | null;
  readonly createdAt: Date;
  readonly sources: readonly ExportSource[];
}

export interface ExportCompany {
  readonly id: string;
  readonly name: string;
  readonly domain: string | null;
  readonly websiteUrl: string | null;
  readonly careersUrl: string | null;
  readonly siren: string | null;
  readonly city: string | null;
  readonly country: string | null;
  readonly industry: string | null;
  readonly tags: readonly string[];
  readonly notes: string | null;
  readonly emails: ExportEmail[];
}

export interface ExportData {
  readonly companies: ExportCompany[];
}

/** Ordre de 6.11 : recrutement d'abord. */
export const TYPE_ORDER = [
  'recruitment',
  'hr',
  'generic',
  'sales',
  'press',
  'support',
  'personal',
  'unknown',
] as const;

/** Les conditions du perimetre, sur les entreprises `c` et les adresses `e`. */
function perimetre(
  request: ExportRequest,
  params: unknown[],
): { companies: string; emails: string } {
  const ajouter = (valeur: unknown) => {
    params.push(valeur);
    return `$${String(params.length)}`;
  };
  const scope = request.scope;
  switch (scope.kind) {
    case 'library':
      return { companies: 'true', emails: 'true' };
    case 'import': {
      const n = ajouter(scope.importId);
      const dans = `c.id in (select r.company_id from import_rows r join imports i on i.id = r.import_id
                             where r.import_id = ${n} and i.user_id = $1)`;
      return { companies: dans, emails: 'true' };
    }
    case 'tag': {
      const n = ajouter(scope.tag.toLowerCase());
      return {
        companies: `(${n} = any(c.tags) or exists (select 1 from emails t
                     where t.company_id = c.id and ${n} = any(t.tags)))`,
        emails: `(${n} = any(c.tags) or ${n} = any(e.tags))`,
      };
    }
    case 'contacts': {
      const n = ajouter(scope.ids);
      return {
        companies: `c.id in (select company_id from emails where id = any(${n}::uuid[]))`,
        emails: `e.id = any(${n}::uuid[])`,
      };
    }
    case 'companies': {
      const n = ajouter(scope.ids);
      return { companies: `c.id = any(${n}::uuid[])`, emails: 'true' };
    }
  }
}

/**
 * Les adresses exportables : dans le filtre de statut, et hors exclusions,
 * qu'elles viennent du statut ou de l'utilisateur.
 */
function filtreAdresses(request: ExportRequest, params: unknown[]): string {
  params.push(EXPORTED_STATUSES[request.statuses]);
  return `e.status::text = any($${String(params.length)}::text[]) and not e.excluded`;
}

/** Le nombre d'adresses que l'export contiendrait, pour choisir entre tout de suite et plus tard. */
export async function countExportRows(userId: string, request: ExportRequest): Promise<number> {
  const params: unknown[] = [userId];
  const { companies, emails } = perimetre(request, params);
  const statut = filtreAdresses(request, params);
  const lu = await query<{ n: number }>(
    `select count(*)::int as n
       from emails e join companies c on c.id = e.company_id
      where c.user_id = $1 and ${companies} and ${emails} and ${statut}`,
    params,
  );
  return lu.rows[0]?.n ?? 0;
}

export async function loadExportData(userId: string, request: ExportRequest): Promise<ExportData> {
  const params: unknown[] = [userId];
  const { companies, emails } = perimetre(request, params);
  const statut = filtreAdresses(request, params);

  const entreprises = await query<{
    id: string;
    name: string;
    domain: string | null;
    website_url: string | null;
    careers_url: string | null;
    siren: string | null;
    city: string | null;
    country: string | null;
    industry: string | null;
    tags: string[];
    notes: string | null;
  }>(
    `select c.id, c.name, c.domain, c.website_url, c.careers_url, c.siren, c.city, c.country,
            c.industry, c.tags, c.notes
       from companies c
      where c.user_id = $1 and ${companies}
      order by lower(c.name), c.id`,
    params.slice(0, params.length - 1),
  );

  const adresses = await query<{
    id: string;
    company_id: string;
    address: string;
    contact_name: string | null;
    salutation: string | null;
    type: string;
    origin: string;
    status: string;
    score: number | null;
    tags: string[];
    reason: string | null;
    verified_at: Date | null;
    created_at: Date;
    sources: ExportSource[];
  }>(
    `select e.id, e.company_id, e.address, e.contact_name, e.salutation, e.type::text as type,
            e.origin::text as origin, e.status::text as status, e.score, e.tags, v.reason,
            e.last_verified_at as verified_at, e.created_at,
            (select json_agg(json_build_object(
                      'kind', s.kind, 'url', s.url, 'provider', s.provider,
                      'method', s.extraction_method, 'excerpt', s.context_excerpt,
                      'discoveredAt', s.discovered_at)
                    -- Une page du site d'abord, puis un fournisseur : la source la
                    -- plus verifiable est celle de la colonne « source_url ».
                    order by case s.kind when 'website' then 0 when 'provider' then 1 else 2 end,
                             s.discovered_at)
               from email_sources s where s.email_id = e.id) as sources
       from emails e
       join companies c on c.id = e.company_id
       left join lateral (
         select reason from verifications
          where email_id = e.id order by verified_at desc, level desc limit 1
       ) v on true
      where c.user_id = $1 and ${companies} and ${emails} and ${statut}
      order by array_position(array['recruitment', 'hr', 'generic', 'sales', 'press',
                                    'support', 'personal', 'unknown'], e.type::text),
               e.score desc nulls last, e.normalized_address`,
    params,
  );

  const parEntreprise = new Map<string, ExportEmail[]>();
  for (const ligne of adresses.rows) {
    const liste = parEntreprise.get(ligne.company_id) ?? [];
    liste.push({
      id: ligne.id,
      address: ligne.address,
      contactName: ligne.contact_name,
      salutation: ligne.salutation,
      type: ligne.type,
      origin: ligne.origin,
      status: ligne.status,
      score: ligne.score,
      tags: ligne.tags,
      verificationReason: ligne.reason,
      verifiedAt: ligne.verified_at,
      createdAt: ligne.created_at,
      sources: ligne.sources,
    });
    parEntreprise.set(ligne.company_id, liste);
  }

  const resultat: ExportCompany[] = [];
  for (const c of entreprises.rows) {
    const toutes = parEntreprise.get(c.id) ?? [];
    // Une selection de contacts n'exporte que les entreprises de ces contacts.
    if (request.scope.kind === 'contacts' && toutes.length === 0) continue;
    resultat.push({
      id: c.id,
      name: c.name,
      domain: c.domain,
      websiteUrl: c.website_url,
      careersUrl: c.careers_url,
      siren: c.siren,
      city: c.city,
      country: c.country,
      industry: c.industry,
      tags: c.tags,
      notes: c.notes,
      emails: request.bestOnly ? meilleures(toutes) : toutes,
    });
  }
  return { companies: resultat };
}

const RANG_STATUT: Record<string, number> = {
  valid: 0,
  accept_all: 1,
  risky: 2,
  unverified: 3,
  unknown: 4,
};

/**
 * F-1103 : une adresse par type, la meilleure. Le statut d'abord (une
 * adresse valide passe devant une adresse au score plus haut mais non
 * confirmee), puis le score. L'ordre par type est conserve.
 */
export function meilleures(adresses: readonly ExportEmail[]): ExportEmail[] {
  const retenues = new Map<string, ExportEmail>();
  for (const adresse of adresses) {
    const actuelle = retenues.get(adresse.type);
    if (actuelle === undefined) {
      retenues.set(adresse.type, adresse);
      continue;
    }
    const rang = (e: ExportEmail) => RANG_STATUT[e.status] ?? 9;
    if (
      rang(adresse) < rang(actuelle) ||
      (rang(adresse) === rang(actuelle) && (adresse.score ?? -1) > (actuelle.score ?? -1))
    ) {
      retenues.set(adresse.type, adresse);
    }
  }
  return TYPE_ORDER.flatMap((type) => {
    const retenue = retenues.get(type);
    return retenue === undefined ? [] : [retenue];
  });
}

export function countRows(data: ExportData): number {
  return data.companies.reduce((total, c) => total + c.emails.length, 0);
}
