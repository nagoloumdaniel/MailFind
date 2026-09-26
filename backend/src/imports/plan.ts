import { UnrecoverableError } from 'bullmq';
import { findOrCreateCompany } from '../companies/repository.js';
import { getPool, query } from '../db/pool.js';
import { getLogger } from '../observability/logger.js';
import { isKnownField, type KnownField } from './fields.js';
import { readSettingsTags } from './settings.js';
import { validateRow } from './validate.js';

/**
 * Tache `import.plan` (section 8.4) : normaliser, dedoublonner, et rattacher
 * chaque ligne acceptee a une entreprise.
 *
 * Deux exigences commandent tout le reste. Un import annule garde ce qui a
 * deja ete traite (F-205). Un import interrompu reprend ou il s'etait arrete,
 * sans refaire ce qui est fait (F-206). Les deux tiennent par la meme chose :
 * une ligne qui porte deja un `company_id` n'est jamais retraitee, et la tache
 * peut donc etre rejouee autant de fois qu'il le faudra.
 */

/** Assez pour limiter les allers-retours, assez peu pour voir l'annulation vite. */
const BATCH_SIZE = 100;

interface StoredColumns {
  readonly headers: readonly string[];
  readonly mapping: readonly (KnownField | null)[];
}

/**
 * Les colonnes sont rangees dans les reglages de l'import au moment de sa
 * creation : sans elles, `raw` serait une suite de valeurs qu'on ne saurait
 * plus relire.
 */
function readColumns(settings: unknown): StoredColumns | undefined {
  if (typeof settings !== 'object' || settings === null) return undefined;
  const colonnes = (settings as { columns?: unknown }).columns;
  if (typeof colonnes !== 'object' || colonnes === null) return undefined;

  const { headers, mapping } = colonnes as { headers?: unknown; mapping?: unknown };
  if (!Array.isArray(headers) || !Array.isArray(mapping)) return undefined;

  return {
    headers: headers.map((valeur) => (typeof valeur === 'string' ? valeur : '')),
    mapping: mapping.map((valeur) =>
      typeof valeur === 'string' && isKnownField(valeur) ? valeur : null,
    ),
  };
}

interface PendingRow {
  id: string;
  line: number;
  raw: Record<string, unknown>;
}

export interface PlanOutcome {
  readonly processed: number;
  readonly companiesCreated: number;
  readonly duplicates: number;
  readonly status: 'completed' | 'cancelled';
}

async function readStatus(importId: string): Promise<string | undefined> {
  const result = await query<{ status: string }>(
    'select status::text as status from imports where id = $1',
    [importId],
  );
  return result.rows[0]?.status;
}

export async function planImport(importId: string, userId: string): Promise<PlanOutcome> {
  const logger = getLogger().child({ importId, job: 'import.plan' });

  const entete = await query<{ settings: unknown; status: string }>(
    'select settings, status::text as status from imports where id = $1 and user_id = $2',
    [importId, userId],
  );
  const importe = entete.rows[0];
  // Ces deux erreurs ne passeront pas en reessayant : BullMQ est prevenu de
  // ne pas perdre trois tentatives a le constater.
  if (importe === undefined) {
    throw new UnrecoverableError(`Import ${importId} introuvable pour ce compte.`);
  }

  const colonnes = readColumns(importe.settings);
  if (colonnes === undefined) {
    throw new UnrecoverableError(
      `Import ${importId} sans colonnes enregistrees : impossible a planifier.`,
    );
  }

  // Les etiquettes choisies a l'etape 4 s'ajoutent a celles du fichier, sur
  // chaque entreprise de l'import, qu'elle soit nouvelle ou deja connue.
  const etiquettesImport = readSettingsTags(importe.settings);

  await query(
    `update imports set status = 'planning', started_at = coalesce(started_at, now())
      where id = $1 and status in ('pending', 'planning')`,
    [importId],
  );

  let traitees = 0;
  let creees = 0;
  let doublons = 0;

  for (;;) {
    const statut = await readStatus(importId);
    if (statut === 'cancelled') {
      // Ce qui est fait reste fait (F-205) : on s'arrete, on ne defait rien.
      logger.info({ traitees }, 'import annule, arret de la planification');
      return {
        processed: traitees,
        companiesCreated: creees,
        duplicates: doublons,
        status: 'cancelled',
      };
    }

    // Seules les lignes acceptees et non encore rattachees : c'est ce qui rend
    // la tache rejouable.
    const lot = await query<PendingRow>(
      `select id, line, raw
         from import_rows
        where import_id = $1 and status = 'accepted' and company_id is null
        order by line
        limit $2`,
      [importId, BATCH_SIZE],
    );

    if (lot.rows.length === 0) break;

    for (const ligne of lot.rows) {
      const valeurs = colonnes.headers.map((header) => {
        const valeur = ligne.raw[header];
        return typeof valeur === 'string' ? valeur : '';
      });

      const verdict = validateRow(colonnes.headers, colonnes.mapping, valeurs);
      if (!verdict.accepted) {
        // La ligne avait ete acceptee a l'arrivee et ne l'est plus : les
        // regles ont change entre temps. On la marque, on ne la perd pas.
        await query(`update import_rows set status = 'rejected', error = $2 where id = $1`, [
          ligne.id,
          verdict.reason,
        ]);
        traitees += 1;
        continue;
      }

      const brouillon =
        etiquettesImport.length === 0
          ? verdict.draft
          : {
              ...verdict.draft,
              tags: [...new Set([...verdict.draft.tags, ...etiquettesImport])],
            };

      const resultat = await findOrCreateCompany(userId, brouillon);
      if (resultat.created) creees += 1;
      else doublons += 1;

      await query(`update import_rows set company_id = $2, status = $3 where id = $1`, [
        ligne.id,
        resultat.companyId,
        resultat.created ? 'accepted' : 'duplicate',
      ]);

      traitees += 1;
    }

    // Le compteur avance par lot : la page de suivi montre une progression
    // reelle, pas une barre qui saute de zero a cent.
    await query(
      `update imports
          set processed_rows = (
                select count(*) from import_rows
                 where import_id = $1 and (company_id is not null or status = 'rejected')
              )
        where id = $1`,
      [importId],
    );
  }

  await query(
    `update imports
        set status = 'completed',
            completed_at = now(),
            processed_rows = total_rows
      where id = $1 and status <> 'cancelled'`,
    [importId],
  );

  logger.info({ traitees, creees, doublons }, 'planification terminee');

  // La suite, identification du domaine et collecte, arrive en Phase 3. A ce
  // stade un import termine est un import range en bibliotheque.
  return {
    processed: traitees,
    companiesCreated: creees,
    duplicates: doublons,
    status: 'completed',
  };
}

/** Marque l'import comme annule. Ce qui est deja traite reste (F-205). */
export async function cancelImport(userId: string, importId: string): Promise<boolean> {
  const result = await getPool().query(
    `update imports set status = 'cancelled'
      where id = $1 and user_id = $2 and status in ('pending', 'planning', 'running')`,
    [importId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Ce que l'utilisateur lit quand la planification a abandonne. La cause
 * technique reste dans les journaux : elle ne lui dirait rien, et elle peut
 * porter des details internes qu'il n'a pas a voir.
 */
export const PLAN_FAILED_MESSAGE =
  "La preparation de l'import a echoue. Les entreprises deja traitees restent dans votre " +
  'bibliotheque.';

/**
 * Passe l'import en echec quand BullMQ a renonce. Sans cela il resterait en
 * « planning » pour toujours, et l'ecran montrerait un import qui tourne alors
 * que plus rien ne s'en occupe. Un import deja annule ou termine n'est pas
 * touche.
 */
export async function markImportFailed(importId: string): Promise<boolean> {
  const result = await getPool().query(
    `update imports set status = 'failed', error = $2, completed_at = now()
      where id = $1 and status in ('pending', 'planning', 'running')`,
    [importId, PLAN_FAILED_MESSAGE],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Les imports qu'aucune tache ne garantit plus de faire avancer : recus mais
 * jamais mis en file (Redis indisponible a ce moment-la), ou en cours quand
 * Redis a perdu ses donnees. Le processus de traitement les remet en file a
 * son demarrage ; l'identifiant stable de la tache rend l'operation sans effet
 * pour ceux dont la tache existe encore (F-206).
 */
export async function listImportsToResume(): Promise<{ importId: string; userId: string }[]> {
  const result = await query<{ id: string; user_id: string }>(
    `select id, user_id from imports
      where status in ('pending', 'planning')
      order by created_at`,
  );
  return result.rows.map((row) => ({ importId: row.id, userId: row.user_id }));
}
