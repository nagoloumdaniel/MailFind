import { z } from 'zod';
import { getPool, query } from '../db/pool.js';
import { AppError } from '../http/problem.js';
import { importSettingsSchema, readStoredSettings } from '../imports/settings.js';
import { verifyEmails, type VerifyDeps } from '../pipeline/verify.js';
import { randomUUID } from 'node:crypto';
import { addSuppressions } from '../suppressions/repository.js';
import { normalizeTags } from './normalize.js';

/**
 * Fusion manuelle de deux entreprises reconnues comme doublons (F-1006).
 * L'entreprise gardee recoit les adresses, les sources, les verifications,
 * les lignes d'import et l'historique de l'autre, complete ce qui lui manque
 * et reunit les etiquettes et les notes ; l'autre disparait.
 */

export const mergeSchema = z
  .object({ targetId: z.uuid(), sourceId: z.uuid() })
  .strict()
  .refine((corps) => corps.targetId !== corps.sourceId, {
    message: 'Une entreprise ne se fusionne pas avec elle-meme.',
  });

/** Champs completes sur l'entreprise gardee quand elle ne les a pas. */
const COMPLETES = [
  'legal_name',
  'website_url',
  'careers_url',
  'contact_form_url',
  'linkedin_url',
  'phone',
  'city',
  'country',
  'industry',
  'employee_range',
] as const;

export async function mergeCompanies(
  deps: VerifyDeps,
  userId: string,
  targetId: string,
  sourceId: string,
): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const lues = await client.query<Record<string, unknown> & { id: string }>(
      `select * from companies where user_id = $1 and id = any($2::uuid[]) for update`,
      [userId, [targetId, sourceId]],
    );
    const cible = lues.rows.find((ligne) => ligne.id === targetId);
    const source = lues.rows.find((ligne) => ligne.id === sourceId);
    if (cible === undefined || source === undefined) {
      throw AppError.notFound("L'une des deux entreprises n'existe pas.");
    }

    // Une adresse presente des deux cotes n'en fait plus qu'une : ses sources
    // et son historique rejoignent celle de l'entreprise gardee.
    await client.query(
      `create temporary table doublons on commit drop as
         select s.id as src, t.id as dst
           from emails s
           join emails t on t.company_id = $1 and t.normalized_address = s.normalized_address
          where s.company_id = $2`,
      [targetId, sourceId],
    );
    await client.query(
      `insert into email_sources (email_id, kind, url, provider, extraction_method,
                                  context_excerpt, discovered_at)
       select d.dst, es.kind, es.url, es.provider, es.extraction_method, es.context_excerpt,
              es.discovered_at
         from email_sources es join doublons d on d.src = es.email_id
       on conflict do nothing`,
    );
    await client.query(
      'update verifications v set email_id = d.dst from doublons d where v.email_id = d.src',
    );
    await client.query('delete from emails where id in (select src from doublons)');
    await client.query('update emails set company_id = $1 where company_id = $2', [
      targetId,
      sourceId,
    ]);
    await client.query('update import_rows set company_id = $1 where company_id = $2', [
      targetId,
      sourceId,
    ]);
    // Une etape existe une fois par import et par entreprise : celle de
    // l'entreprise gardee l'emporte quand les deux ont la meme.
    await client.query(
      `delete from pipeline_jobs p
        where p.company_id = $2
          and exists (select 1 from pipeline_jobs q
                       where q.company_id = $1 and q.step = p.step
                         and q.import_id is not distinct from p.import_id)`,
      [targetId, sourceId],
    );
    await client.query('update pipeline_jobs set company_id = $1 where company_id = $2', [
      targetId,
      sourceId,
    ]);

    // Le domaine et le SIREN sont uniques par compte : l'entreprise qui part
    // les rend avant que la gardee ne les prenne.
    await client.query('update companies set domain = null, siren = null where id = $1', [
      sourceId,
    ]);
    const affectations: string[] = [];
    const valeurs: unknown[] = [targetId];
    const poser = (sql: string, valeur: unknown) => {
      valeurs.push(valeur);
      affectations.push(sql.replace('?', `$${String(valeurs.length)}`));
    };
    for (const colonne of COMPLETES) {
      if (cible[colonne] === null && source[colonne] !== null)
        poser(`${colonne} = ?`, source[colonne]);
    }
    if (cible.domain === null && source.domain !== null) {
      poser('domain = ?', source.domain);
      poser('domain_status = ?::domain_status', source.domain_status);
    }
    if (cible.siren === null && source.siren !== null) poser('siren = ?', source.siren);
    const etiquettes = [
      ...(Array.isArray(cible.tags) ? (cible.tags as string[]) : []),
      ...(Array.isArray(source.tags) ? (source.tags as string[]) : []),
    ];
    poser('tags = ?', normalizeTags(etiquettes.join(',')));
    const notes = [cible.notes, source.notes].filter(
      (note): note is string => typeof note === 'string' && note.trim() !== '',
    );
    if (notes.length > 0) poser('notes = ?', notes.join('\n\n'));
    await client.query(
      `update companies set ${affectations.join(', ')}, updated_at = now() where id = $1`,
      valeurs,
    );
    await client.query('delete from companies where id = $1', [sourceId]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  // Le domaine officiel a pu changer, et des sources se sont ajoutees : les
  // scores sont recalcules, sans rien payer.
  const lue = await query<{ domain: string | null; settings: unknown }>(
    `select c.domain,
            (select i.settings from import_rows r join imports i on i.id = r.import_id
              where r.company_id = c.id order by i.created_at desc limit 1) as settings
       from companies c where c.id = $1`,
    [targetId],
  );
  const reglages =
    lue.rows[0]?.settings == null
      ? importSettingsSchema.parse({})
      : readStoredSettings(lue.rows[0].settings);
  await verifyEmails(deps, {
    userId,
    companyId: targetId,
    runKey: randomUUID(),
    officialDomain: lue.rows[0]?.domain ?? null,
    wantedTypes: reglages.emailTypes,
    mailboxCheck: 'never',
  });
}

export const bulkCompaniesSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('tag'),
      ids: z.array(z.uuid()).min(1).max(1000),
      tags: z.array(z.string().max(50)).min(1).max(20),
    })
    .strict(),
  z
    .object({
      action: z.literal('untag'),
      ids: z.array(z.uuid()).min(1).max(1000),
      tags: z.array(z.string().max(50)).min(1).max(20),
    })
    .strict(),
  z
    .object({
      action: z.literal('delete'),
      ids: z.array(z.uuid()).min(1).max(1000),
      suppress: z.boolean().default(false),
    })
    .strict(),
]);

/**
 * Actions en masse sur des entreprises (F-1005). Supprimer efface
 * l'entreprise et ses adresses, sources et verifications comprises (R-05).
 */
export async function bulkCompanies(
  userId: string,
  input: z.infer<typeof bulkCompaniesSchema>,
): Promise<{ updated: number; suppressed: number }> {
  if (input.action === 'delete') {
    let suppressed = 0;
    if (input.suppress) {
      const adresses = await query<{ normalized_address: string }>(
        `select normalized_address from emails
          where user_id = $1 and company_id = any($2::uuid[])`,
        [userId, input.ids],
      );
      const resultat = await addSuppressions(
        userId,
        adresses.rows.map((ligne) => ligne.normalized_address),
        "Entreprise supprimee par l'utilisateur",
      );
      suppressed = resultat.added + resultat.alreadyListed;
    }
    const effacees = await query(
      'delete from companies where user_id = $1 and id = any($2::uuid[])',
      [userId, input.ids],
    );
    return { updated: effacees.rowCount ?? 0, suppressed };
  }
  const etiquettes = normalizeTags(input.tags.join(','));
  const sql =
    input.action === 'tag'
      ? `update companies set tags = (select array(select distinct unnest(tags || $3::text[]) order by 1)),
                updated_at = now()
          where user_id = $1 and id = any($2::uuid[])`
      : `update companies set tags = (select coalesce(array_agg(t order by t), '{}')
                                       from unnest(tags) t where not (t = any($3::text[]))),
                updated_at = now()
          where user_id = $1 and id = any($2::uuid[])`;
  const resultat = await query(sql, [userId, input.ids, etiquettes]);
  return { updated: resultat.rowCount ?? 0, suppressed: 0 };
}
