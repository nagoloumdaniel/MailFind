import { recordAuditEvent } from '../audit/repository.js';
import { AppError } from '../http/problem.js';
import { enqueueImportPlan, type ImportPlanJob } from '../queue/queues.js';
import type { KnownField } from './fields.js';
import { createImport, type ImportSummary, type PreparedRow } from './repository.js';
import type { ImportSettings } from './settings.js';
import { validateRow } from './validate.js';

/**
 * Un import tel que l'interface ou l'API le soumet : un en-tete, la
 * correspondance de chaque colonne, les lignes et les reglages. Les deux
 * chemins passent par ici, pour qu'une ligne refusee a l'ecran le soit aussi
 * par l'API, et inversement.
 */
export interface ImportSubmission {
  readonly userId: string;
  readonly filename: string;
  readonly headers: readonly string[];
  readonly mapping: readonly (KnownField | null)[];
  readonly rows: readonly (readonly string[])[];
  readonly settings: ImportSettings;
}

export async function submitImport(
  submission: ImportSubmission,
  options: {
    /**
     * Faux quand l'appelant planifie lui-meme l'import avant de le mettre en
     * file : la tache ne fera plus que lancer le pipeline.
     */
    readonly enqueue?: boolean;
    /**
     * La mise en file de la planification. Celle de BullMQ par defaut ; le
     * parcours de bout en bout y met un traitement immediat, pour ne pas
     * dependre d'un processus de traitement a part.
     */
    readonly enqueuePlan?: (job: ImportPlanJob) => Promise<void>;
  } = {},
): Promise<ImportSummary> {
  const { userId, filename, headers, mapping, rows, settings } = submission;

  if (mapping.length !== headers.length) {
    throw AppError.badRequest(
      'mapping_mismatch',
      'Import refuse',
      "La correspondance des colonnes ne correspond pas a l'en-tete du fichier.",
    );
  }

  // La validation est refaite ici en entier. L'apercu du navigateur est un
  // service rendu a l'utilisateur, pas une autorite (S-07).
  const preparees: PreparedRow[] = rows.map((row, index) => {
    const verdict = validateRow(headers, mapping, row);
    const raw: Record<string, string> = {};
    headers.forEach((header, colonne) => {
      const valeur = row[colonne];
      if (valeur !== undefined && valeur !== '') raw[header] = valeur;
    });

    return verdict.accepted
      ? { line: index + 2, raw, status: 'accepted', error: undefined }
      : { line: index + 2, raw, status: 'rejected', error: verdict.reason };
  });

  if (preparees.every((ligne) => ligne.status === 'rejected')) {
    throw AppError.badRequest(
      'no_usable_row',
      'Aucune ligne exploitable',
      "Aucune ligne de ce fichier ne porte de nom d'entreprise, de domaine, de site ou de page carrieres.",
    );
  }

  const resume = await createImport({
    userId,
    filename,
    // Les colonnes voyagent avec les reglages : sans elles, `raw` serait une
    // suite de valeurs que la planification ne saurait plus relire.
    settings: { ...settings, columns: { headers, mapping } },
    rows: preparees,
  });

  if (options.enqueue !== false) {
    await (options.enqueuePlan ?? enqueueImportPlan)({ importId: resume.id, userId });
  }

  await recordAuditEvent({
    userId,
    action: 'import.created',
    entity: 'import',
    entityId: resume.id,
    // Des compteurs, pas de contenu : le journal d'audit ne porte aucune
    // donnee du fichier (S-03).
    metadata: {
      totalRows: resume.totalRows,
      acceptedRows: resume.acceptedRows,
      rejectedRows: resume.rejectedRows,
    },
  });

  return resume;
}
