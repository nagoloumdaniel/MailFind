import type pg from 'pg';
import { getPool } from '../db/pool.js';
import type { CompanyDraft } from '../imports/validate.js';
import { mergeDraft, type CompanyPatch, type ExistingCompany } from './merge.js';

/**
 * Dedoublonnage et creation des entreprises (F-303).
 *
 * L'ordre des cles est celui du cahier des charges : domaine, puis SIREN, puis
 * nom normalise et ville. Une ligne qui retombe sur une entreprise connue s'y
 * rattache, elle n'en cree jamais une seconde.
 */

interface CompanyRow {
  id: string;
  name: string;
  normalized_name: string;
  domain: string | null;
  website_url: string | null;
  careers_url: string | null;
  siren: string | null;
  city: string | null;
  country: string | null;
  industry: string | null;
  notes: string | null;
  tags: string[];
  attributes: Record<string, unknown>;
}

const COLUMNS = `id, name, normalized_name, domain, website_url, careers_url, siren, city,
                 country, industry, notes, tags, attributes`;

function toExisting(row: CompanyRow): ExistingCompany {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    domain: row.domain,
    websiteUrl: row.website_url,
    careersUrl: row.careers_url,
    siren: row.siren,
    city: row.city,
    country: row.country,
    industry: row.industry,
    notes: row.notes,
    tags: row.tags,
    attributes: row.attributes,
  };
}

/**
 * Le nom sous lequel une entreprise est rangee, et celui sous lequel on la
 * cherche. Une seule fonction pour les deux : une ligne reduite a une page
 * carrieres n'a pas de nom, et si la recherche et l'insertion ne s'accordaient
 * pas sur celui qu'on lui donne, la seconde ligne identique heurterait l'index
 * d'unicite au lieu de rejoindre la premiere.
 */
function identityOf(draft: CompanyDraft): { name: string; normalizedName: string } {
  const name = draft.name ?? draft.domain ?? draft.careersUrl ?? 'Entreprise sans nom';
  return { name, normalizedName: draft.normalizedName ?? draft.domain ?? name.toLowerCase() };
}

/**
 * Cherche l'entreprise correspondant au brouillon, dans l'ordre des cles.
 *
 * `for update` tient la ligne le temps de la transaction : sans cela, deux
 * lignes du meme fichier parlant de la meme entreprise pourraient la creer
 * toutes les deux, chacune ayant constate qu'elle n'existait pas.
 */
async function findExisting(
  client: pg.PoolClient,
  userId: string,
  draft: CompanyDraft,
): Promise<ExistingCompany | undefined> {
  if (draft.domain !== undefined) {
    const parDomaine = await client.query<CompanyRow>(
      `select ${COLUMNS} from companies where user_id = $1 and domain = $2 for update`,
      [userId, draft.domain],
    );
    const row = parDomaine.rows[0];
    if (row !== undefined) return toExisting(row);
  }

  if (draft.siren !== undefined) {
    const parSiren = await client.query<CompanyRow>(
      `select ${COLUMNS} from companies where user_id = $1 and siren = $2 for update`,
      [userId, draft.siren],
    );
    const row = parSiren.rows[0];
    if (row !== undefined) return toExisting(row);
  }

  // Dernier recours, et seulement quand la ligne n'apporte ni domaine ni
  // SIREN. Une ligne reduite a « Doctolib, Paris » doit rejoindre le Doctolib
  // deja connu, meme si celui-ci porte un domaine : c'est exactement le doublon
  // que F-303 interdit de creer. En revanche, deux lignes homonymes qui
  // portent chacune un domaine different sont deux entreprises, et les
  // rapprocher ferait perdre l'un des deux domaines.
  if (draft.domain === undefined && draft.siren === undefined) {
    const parNom = await client.query<CompanyRow>(
      `select ${COLUMNS} from companies
        where user_id = $1
          and normalized_name = $2
          and coalesce(lower(city), '') = coalesce(lower($3), '')
        order by created_at
        limit 1
        for update`,
      [userId, identityOf(draft).normalizedName, draft.city ?? null],
    );
    const row = parNom.rows[0];
    if (row !== undefined) return toExisting(row);
  }

  return undefined;
}

const PATCH_COLUMNS: Record<keyof CompanyPatch, string> = {
  domain: 'domain',
  websiteUrl: 'website_url',
  careersUrl: 'careers_url',
  siren: 'siren',
  city: 'city',
  country: 'country',
  industry: 'industry',
  notes: 'notes',
  tags: 'tags',
  attributes: 'attributes',
};

/**
 * Retire du complement le domaine ou le SIREN qu'une autre entreprise porte
 * deja.
 *
 * Le cas arrive avec un fichier desordonne : une ligne donne le domaine, une
 * autre le SIREN, et une troisieme les deux. Elle rejoint la fiche trouvee par
 * le domaine, et lui apporter le SIREN de l'autre fiche violerait l'index
 * d'unicite, donc ferait echouer tout l'import. Deplacer le SIREN serait pire :
 * ce serait decider, sans preuve, laquelle des deux fiches a raison. On ne
 * complete donc que ce qui est libre ; la fusion de deux fiches reste un geste
 * de l'utilisateur.
 */
async function withoutTakenKeys(
  client: pg.PoolClient,
  userId: string,
  companyId: string,
  patch: CompanyPatch,
): Promise<CompanyPatch> {
  if (patch.domain === undefined && patch.siren === undefined) return patch;

  const prises = await client.query<{ domain: string | null; siren: string | null }>(
    `select domain, siren from companies
      where user_id = $1 and id <> $2 and (domain = $3 or siren = $4)`,
    [userId, companyId, patch.domain ?? null, patch.siren ?? null],
  );

  const { domain, siren, ...reste } = patch;
  const domainePris = prises.rows.some((prise) => prise.domain === domain);
  const sirenPris = prises.rows.some((prise) => prise.siren === siren);

  return {
    ...reste,
    ...(domain === undefined || domainePris ? {} : { domain }),
    ...(siren === undefined || sirenPris ? {} : { siren }),
  };
}

async function applyPatch(
  client: pg.PoolClient,
  userId: string,
  companyId: string,
  complement: CompanyPatch,
): Promise<void> {
  const patch = await withoutTakenKeys(client, userId, companyId, complement);
  const entrees = Object.entries(patch) as [keyof CompanyPatch, unknown][];
  if (entrees.length === 0) return;

  const affectations: string[] = [];
  const valeurs: unknown[] = [companyId];

  for (const [cle, valeur] of entrees) {
    valeurs.push(cle === 'attributes' ? JSON.stringify(valeur) : valeur);
    affectations.push(`${PATCH_COLUMNS[cle]} = $${String(valeurs.length)}`);
  }

  await client.query(
    `update companies set ${affectations.join(', ')}, updated_at = now() where id = $1`,
    valeurs,
  );
}

export interface CompanyOutcome {
  readonly companyId: string;
  /** Faux quand la ligne a rejoint une entreprise deja connue (F-303). */
  readonly created: boolean;
}

export async function findOrCreateCompany(
  userId: string,
  draft: CompanyDraft,
): Promise<CompanyOutcome> {
  const client = await getPool().connect();

  try {
    await client.query('begin');

    const existante = await findExisting(client, userId, draft);
    if (existante !== undefined) {
      await applyPatch(client, userId, existante.id, mergeDraft(existante, draft));
      await client.query('commit');
      return { companyId: existante.id, created: false };
    }

    const { name: nom, normalizedName: nomNormalise } = identityOf(draft);

    try {
      const cree = await client.query<{ id: string }>(
        `insert into companies
           (user_id, name, normalized_name, domain, domain_status, website_url, careers_url,
            siren, city, country, industry, notes, tags, attributes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         returning id`,
        [
          userId,
          nom,
          nomNormalise,
          draft.domain ?? null,
          draft.domain === undefined ? 'unknown' : 'provided',
          draft.websiteUrl ?? null,
          draft.careersUrl ?? null,
          draft.siren ?? null,
          draft.city ?? null,
          draft.country ?? null,
          draft.industry ?? null,
          draft.notes ?? null,
          draft.tags,
          JSON.stringify(draft.attributes),
        ],
      );

      const ligne = cree.rows[0];
      if (ligne === undefined) throw new Error("L'entreprise n'a pas ete creee.");

      await client.query('commit');
      return { companyId: ligne.id, created: true };
    } catch (error) {
      await client.query('rollback');

      // 23505 : un index d'unicite a parle. Une autre tache a cree la meme
      // entreprise entre notre recherche et notre insertion. Ce n'est pas une
      // panne, c'est la course que les index sont la pour arbitrer : on relit.
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        const rattrapee = await retryFind(userId, draft);
        if (rattrapee !== undefined) return { companyId: rattrapee, created: false };
      }
      throw error;
    }
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function retryFind(userId: string, draft: CompanyDraft): Promise<string | undefined> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const trouvee = await findExisting(client, userId, draft);
    if (trouvee !== undefined) {
      await applyPatch(client, userId, trouvee.id, mergeDraft(trouvee, draft));
    }
    await client.query('commit');
    return trouvee?.id;
  } catch (error) {
    // Rendue a la reserve sans retour arriere, la connexion resterait dans une
    // transaction avortee, et la requete suivante qui la reprendrait echouerait
    // sans rapport avec sa propre faute.
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function countCompanies(userId: string): Promise<number> {
  const result = await getPool().query<{ n: number }>(
    'select count(*)::int as n from companies where user_id = $1',
    [userId],
  );
  return result.rows[0]?.n ?? 0;
}
