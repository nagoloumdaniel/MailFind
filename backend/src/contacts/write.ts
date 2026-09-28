import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { findOrCreateCompany } from '../companies/repository.js';
import { normalizeCompanyName, normalizeDomain, normalizeTags } from '../companies/normalize.js';
import { getPool, query } from '../db/pool.js';
import { classifyLocalPart } from '../emails/roles.js';
import { AppError } from '../http/problem.js';
import { importSettingsSchema, readStoredSettings } from '../imports/settings.js';
import { verifyEmails, type VerifyDeps } from '../pipeline/verify.js';
import { isSuppressed, loadSuppressedHashes } from '../suppressions/repository.js';
import { normalizeAddress } from '../verification/local.js';
import { EMAIL_TYPES } from './query.js';

/**
 * Creation et modification d'un contact a la main (F-1013, F-1014). Une
 * adresse saisie ou corrigee passe les memes controles que les autres (6.7),
 * et sa source dit qu'elle vient de l'utilisateur : la regle « chaque adresse
 * a une source » vaut aussi pour elle.
 */

const texte = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((valeur) => (valeur === '' ? null : valeur));

const champs = {
  address: z.string().trim().min(3).max(320),
  companyId: z.uuid(),
  newCompany: z.object({
    name: z.string().trim().min(1).max(200),
    domain: z.string().trim().max(253).optional(),
  }),
  contactName: texte(200),
  salutation: texte(100),
  type: z.enum(EMAIL_TYPES),
  tags: z.array(z.string().max(50)).max(20),
};

export const createContactSchema = z
  .object({
    address: champs.address,
    companyId: champs.companyId.optional(),
    newCompany: champs.newCompany.optional(),
    contactName: champs.contactName,
    salutation: champs.salutation,
    type: champs.type.optional(),
    tags: champs.tags.optional(),
  })
  .strict()
  .refine((corps) => (corps.companyId === undefined) !== (corps.newCompany === undefined), {
    message: 'Une entreprise existante ou une nouvelle, pas les deux.',
  });

export const updateContactSchema = z
  .object({
    address: champs.address.optional(),
    companyId: champs.companyId.optional(),
    newCompany: champs.newCompany.optional(),
    contactName: champs.contactName,
    salutation: champs.salutation,
    type: champs.type.optional(),
    tags: champs.tags.optional(),
  })
  .strict()
  .refine((corps) => corps.companyId === undefined || corps.newCompany === undefined, {
    message: 'Une entreprise existante ou une nouvelle, pas les deux.',
  });

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

function adresseValide(brute: string): string {
  const normalisee = normalizeAddress(brute);
  if (normalisee === undefined) {
    throw AppError.badRequest(
      'invalid_address',
      'Adresse refusee',
      "Cette adresse n'a pas la forme d'une adresse email.",
    );
  }
  return normalisee;
}

async function refuserSiSupprimee(userId: string, normalisee: string): Promise<void> {
  // R-04 : une adresse de la liste de suppression ne revient pas, meme saisie
  // a la main. L'utilisateur peut l'en retirer depuis la page Compte.
  if (isSuppressed(await loadSuppressedHashes(userId), normalisee)) {
    throw new AppError({
      status: 409,
      code: 'address_suppressed',
      title: 'Adresse supprimee',
      detail:
        'Cette adresse est dans votre liste de suppression. Retirez-la de la liste depuis la page Compte pour pouvoir la saisir.',
    });
  }
}

function dejaPresente(): AppError {
  return new AppError({
    status: 409,
    code: 'contact_exists',
    title: 'Adresse deja presente',
    detail: 'Cette entreprise a deja cette adresse.',
  });
}

function estDoublon(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === 'emails_unique_per_company'
  );
}

/** L'entreprise choisie, verifiee comme etant du compte, ou creee. */
async function entreprise(
  userId: string,
  choix: {
    companyId?: string | undefined;
    newCompany?: { name: string; domain?: string | undefined } | undefined;
  },
): Promise<string> {
  if (choix.companyId !== undefined) {
    const lue = await query<{ id: string }>(
      'select id from companies where id = $1 and user_id = $2',
      [choix.companyId, userId],
    );
    if (lue.rows[0] === undefined) throw AppError.notFound("Cette entreprise n'existe pas.");
    return choix.companyId;
  }
  const nouvelle = choix.newCompany;
  if (nouvelle === undefined) throw new Error('Entreprise absente');
  const domaine =
    nouvelle.domain === undefined || nouvelle.domain === ''
      ? undefined
      : normalizeDomain(nouvelle.domain);
  if (nouvelle.domain !== undefined && nouvelle.domain !== '' && domaine === undefined) {
    throw AppError.badRequest(
      'invalid_domain',
      'Domaine refuse',
      "Ce domaine n'est pas exploitable.",
    );
  }
  const nomNormalise = normalizeCompanyName(nouvelle.name);
  if (nomNormalise === '') {
    throw AppError.badRequest(
      'invalid_company_name',
      'Nom refuse',
      "Ce nom ne designe pas une entreprise : il ne reste qu'une forme juridique.",
    );
  }
  const { companyId } = await findOrCreateCompany(userId, {
    name: nouvelle.name,
    normalizedName: nomNormalise,
    domain: domaine,
    websiteUrl: undefined,
    careersUrl: undefined,
    siren: undefined,
    city: undefined,
    country: undefined,
    industry: undefined,
    contactName: undefined,
    tags: [],
    notes: undefined,
    attributes: {},
  });
  return companyId;
}

/**
 * Controles locaux et score de l'adresse, tout de suite. La verification de
 * boite, payante, reste un choix explicite : elle n'est pas lancee ici.
 */
export async function verifyContactNow(
  deps: VerifyDeps,
  userId: string,
  emailId: string,
): Promise<void> {
  const lu = await query<{ company_id: string; domain: string | null; settings: unknown }>(
    `select e.company_id, c.domain,
            (select i.settings from import_rows r join imports i on i.id = r.import_id
              where r.company_id = c.id order by i.created_at desc limit 1) as settings
       from emails e join companies c on c.id = e.company_id
      where e.id = $1 and e.user_id = $2`,
    [emailId, userId],
  );
  const ligne = lu.rows[0];
  if (ligne === undefined) return;
  // Les types recherches par le dernier import de l'entreprise, ou ceux par
  // defaut : c'est eux que le critere « role pertinent » du score regarde.
  const reglages =
    ligne.settings === null ? importSettingsSchema.parse({}) : readStoredSettings(ligne.settings);
  await verifyEmails(deps, {
    userId,
    companyId: ligne.company_id,
    runKey: randomUUID(),
    officialDomain: ligne.domain,
    wantedTypes: reglages.emailTypes,
    mailboxCheck: 'never',
    emailIds: [emailId],
  });
}

export async function createContact(
  deps: VerifyDeps,
  userId: string,
  input: CreateContactInput,
): Promise<string> {
  const normalisee = adresseValide(input.address);
  await refuserSiSupprimee(userId, normalisee);
  const companyId = await entreprise(userId, input);
  const locale = normalisee.split('@')[0] ?? '';

  const client = await getPool().connect();
  let id: string;
  try {
    await client.query('begin');
    const cree = await client.query<{ id: string }>(
      `insert into emails (company_id, user_id, address, normalized_address, local_part, type,
                           origin, contact_name, salutation, tags)
       values ($1, $2, $3, $4, $5, $6::email_type, 'manual', $7, $8, $9)
       returning id`,
      [
        companyId,
        userId,
        input.address.trim(),
        normalisee,
        locale,
        input.type ?? classifyLocalPart(locale),
        input.contactName ?? null,
        input.salutation ?? null,
        normalizeTags((input.tags ?? []).join(',')),
      ],
    );
    id = cree.rows[0]?.id ?? '';
    await client.query(
      `insert into email_sources (email_id, kind, context_excerpt)
       values ($1, 'manual', 'Saisie par l''utilisateur.')`,
      [id],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    if (estDoublon(error)) throw dejaPresente();
    throw error;
  } finally {
    client.release();
  }

  await verifyContactNow(deps, userId, id);
  return id;
}

export async function updateContact(
  deps: VerifyDeps,
  userId: string,
  id: string,
  input: UpdateContactInput,
): Promise<boolean> {
  const lu = await query<{ normalized_address: string; company_id: string }>(
    'select normalized_address, company_id from emails where id = $1 and user_id = $2',
    [id, userId],
  );
  const actuel = lu.rows[0];
  if (actuel === undefined) return false;

  const normalisee = input.address === undefined ? undefined : adresseValide(input.address);
  const change = normalisee !== undefined && normalisee !== actuel.normalized_address;
  if (change) await refuserSiSupprimee(userId, normalisee);
  const companyId =
    input.companyId === undefined && input.newCompany === undefined
      ? undefined
      : await entreprise(userId, input);

  const affectations: string[] = [];
  const valeurs: unknown[] = [id, userId];
  const poser = (colonne: string, valeur: unknown, cast = '') => {
    valeurs.push(valeur);
    affectations.push(`${colonne} = $${String(valeurs.length)}${cast}`);
  };
  if (input.contactName !== undefined) poser('contact_name', input.contactName);
  if (input.salutation !== undefined) poser('salutation', input.salutation);
  if (input.tags !== undefined) poser('tags', normalizeTags(input.tags.join(',')));
  if (companyId !== undefined) poser('company_id', companyId);
  if (change && input.address !== undefined) {
    const locale = normalisee.split('@')[0] ?? '';
    poser('address', input.address.trim());
    poser('normalized_address', normalisee);
    poser('local_part', locale);
    // Une adresse corrigee n'est plus celle qui a ete trouvee : elle devient
    // une saisie de l'utilisateur, et repart sans statut ni score.
    affectations.push(
      "origin = 'manual'",
      "status = 'unverified'",
      'score = null',
      'score_breakdown = null',
      'last_verified_at = null',
    );
    if (input.type === undefined) poser('type', classifyLocalPart(locale), '::email_type');
  }
  if (input.type !== undefined) poser('type', input.type, '::email_type');

  const client = await getPool().connect();
  try {
    await client.query('begin');
    if (affectations.length > 0) {
      await client.query(
        `update emails set ${affectations.join(', ')}, updated_at = now()
          where id = $1 and user_id = $2`,
        valeurs,
      );
    }
    if (change) {
      // Les sources de l'ancienne adresse ne disent rien de la nouvelle : elles
      // sont remplacees par une source qui garde la trace de la correction.
      const ancienne = await client.query<{ url: string | null }>(
        `select url from email_sources where email_id = $1 and url is not null
          order by discovered_at limit 1`,
        [id],
      );
      const vue = ancienne.rows[0]?.url;
      const nouvelle = await client.query<{ id: string }>(
        `insert into email_sources (email_id, kind, context_excerpt)
         values ($1, 'manual', $2) returning id`,
        [
          id,
          `Adresse corrigee par l'utilisateur ; ancienne adresse ${actuel.normalized_address}${
            vue === undefined ? '' : `, vue sur ${vue}`
          }.`.slice(0, 200),
        ],
      );
      await client.query('delete from email_sources where email_id = $1 and id <> $2', [
        id,
        nouvelle.rows[0]?.id,
      ]);
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    if (estDoublon(error)) throw dejaPresente();
    throw error;
  } finally {
    client.release();
  }

  await verifyContactNow(deps, userId, id);
  return true;
}
