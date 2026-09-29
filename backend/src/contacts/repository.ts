import { query } from '../db/pool.js';
import { likePattern, SORT_EXPRESSIONS, type ContactQuery } from './query.js';
import { SHOWN_EMAIL } from '../emails/visibility.js';

/**
 * La page Contacts : toutes les adresses de la bibliotheque, quelle que soit
 * leur origine (F-1010). L'appartenance est dans chaque requete (S-04).
 */

export interface Contact {
  readonly id: string;
  readonly address: string;
  readonly contactName: string | null;
  readonly salutation: string | null;
  readonly tags: readonly string[];
  readonly company: { readonly id: string; readonly name: string; readonly domain: string | null };
  readonly type: string;
  readonly origin: string;
  readonly status: string;
  readonly score: number | null;
  readonly scoreBreakdown: unknown;
  /** Hors des exports et des envois, par son statut ou par l'utilisateur. */
  readonly excluded: boolean;
  readonly excludedReason: string | null;
  readonly verificationReason: string | null;
  readonly verifiedAt: Date | null;
  readonly createdAt: Date;
  readonly source: {
    readonly kind: string;
    readonly url: string | null;
    readonly provider: string | null;
  } | null;
}

interface ContactRow {
  id: string;
  address: string;
  contact_name: string | null;
  salutation: string | null;
  tags: string[];
  company_id: string;
  company_name: string;
  company_domain: string | null;
  type: string;
  origin: string;
  status: string;
  score: number | null;
  score_breakdown: unknown;
  excluded: boolean;
  excluded_reason: string | null;
  reason: string | null;
  verified_at: Date | null;
  created_at: Date;
  source_kind: string | null;
  source_url: string | null;
  source_provider: string | null;
}

const SELECT_CONTACT = `
  select e.id, e.address, e.contact_name, e.salutation, e.tags,
         c.id as company_id, c.name as company_name, c.domain as company_domain,
         e.type::text as type, e.origin::text as origin, e.status::text as status,
         e.score, e.score_breakdown, e.excluded, e.excluded_reason, v.reason, e.last_verified_at as verified_at,
         e.created_at, s.kind::text as source_kind, s.url as source_url,
         s.provider as source_provider
    from emails e
    join companies c on c.id = e.company_id
    left join lateral (
      select reason from verifications
       where email_id = e.id order by verified_at desc, level desc limit 1
    ) v on true
    left join lateral (
      select kind, url, provider from email_sources
       where email_id = e.id order by discovered_at, id limit 1
    ) s on true`;

function versContact(ligne: ContactRow): Contact {
  return {
    id: ligne.id,
    address: ligne.address,
    contactName: ligne.contact_name,
    salutation: ligne.salutation,
    tags: ligne.tags,
    company: { id: ligne.company_id, name: ligne.company_name, domain: ligne.company_domain },
    type: ligne.type,
    origin: ligne.origin,
    status: ligne.status,
    score: ligne.score,
    scoreBreakdown: ligne.score_breakdown,
    excluded: ligne.excluded,
    excludedReason: ligne.excluded_reason,
    verificationReason: ligne.reason,
    verifiedAt: ligne.verified_at,
    createdAt: ligne.created_at,
    source:
      ligne.source_kind === null
        ? null
        : { kind: ligne.source_kind, url: ligne.source_url, provider: ligne.source_provider },
  };
}

/** Les conditions de la recherche et des filtres, combinables (F-1012). */
function conditions(userId: string, filtre: ContactQuery): { where: string; params: unknown[] } {
  const params: unknown[] = [userId];
  const parties = [
    'e.user_id = $1',
    // F-503 : une candidate que la verification a refusee n'est pas montree.
    SHOWN_EMAIL,
  ];
  const ajouter = (sql: (n: string) => string, valeur: unknown) => {
    params.push(valeur);
    parties.push(sql(`$${String(params.length)}`));
  };

  if (filtre.q !== '') {
    ajouter(
      (n) =>
        `(e.normalized_address ilike ${n} or e.contact_name ilike ${n}
          or c.name ilike ${n} or c.domain ilike ${n})`,
      likePattern(filtre.q.toLowerCase()),
    );
  }
  if (filtre.status.length > 0) ajouter((n) => `e.status::text = any(${n}::text[])`, filtre.status);
  if (filtre.type.length > 0) ajouter((n) => `e.type::text = any(${n}::text[])`, filtre.type);
  if (filtre.origin.length > 0) ajouter((n) => `e.origin::text = any(${n}::text[])`, filtre.origin);
  if (filtre.tag !== undefined && filtre.tag !== '') {
    ajouter((n) => `(${n} = any(e.tags) or ${n} = any(c.tags))`, filtre.tag.toLowerCase());
  }
  if (filtre.companyId !== undefined) ajouter((n) => `e.company_id = ${n}`, filtre.companyId);
  if (filtre.importId !== undefined) {
    ajouter(
      (n) =>
        `e.company_id in (select r.company_id from import_rows r join imports i on i.id = r.import_id
                           where r.import_id = ${n} and i.user_id = $1)`,
      filtre.importId,
    );
  }
  return { where: parties.join(' and '), params };
}

export async function listContacts(
  userId: string,
  filtre: ContactQuery,
): Promise<{ total: number; contacts: Contact[] }> {
  const { where, params } = conditions(userId, filtre);
  const total = await query<{ n: number }>(
    `select count(*)::int as n from emails e join companies c on c.id = e.company_id where ${where}`,
    params,
  );

  // F-1011 : les valeurs vides toujours en fin de liste, dans les deux sens.
  const sens = filtre.dir === 'desc' ? 'desc' : 'asc';
  const ordre = `${SORT_EXPRESSIONS[filtre.sort]} ${sens} nulls last, e.id ${sens}`;
  const lignes = await query<ContactRow>(
    `${SELECT_CONTACT}
      where ${where}
      order by ${ordre}
      limit $${String(params.length + 1)} offset $${String(params.length + 2)}`,
    [...params, filtre.pageSize, (filtre.page - 1) * filtre.pageSize],
  );
  return { total: total.rows[0]?.n ?? 0, contacts: lignes.rows.map(versContact) };
}

export async function findContact(userId: string, id: string): Promise<Contact | undefined> {
  const lu = await query<ContactRow>(`${SELECT_CONTACT} where e.user_id = $1 and e.id = $2`, [
    userId,
    id,
  ]);
  const ligne = lu.rows[0];
  return ligne === undefined ? undefined : versContact(ligne);
}
