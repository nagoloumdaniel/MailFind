import { query } from '../db/pool.js';
import { AppError } from '../http/problem.js';
import { countExportRows, countRows, loadExportData } from './data.js';
import { campaignMailerCsv, csvCompanies, csvEmails, jsonExport, xlsxExport } from './formats.js';
import {
  EXPORT_RETENTION_DAYS,
  EXTENSIONS,
  exportFilename,
  exportRequestSchema,
  SYNC_EXPORT_MAX_ROWS,
  type ExportRequest,
} from './request.js';
import type { ExportStorage } from './storage.js';

/**
 * Exports (6.11) : produits tout de suite jusqu'a 2 000 lignes, en tache
 * au-dela, et journalises dans tous les cas (F-1104, F-1106).
 */

export interface BuiltExport {
  readonly body: Buffer;
  readonly filename: string;
  readonly contentType: string;
  /** Adresses dans le fichier. */
  readonly rows: number;
  /** Adresses laissees de cote par le format (Campaign Mailer). */
  readonly skipped: number;
}

export async function buildExport(
  userId: string,
  request: ExportRequest,
  maintenant: Date,
): Promise<BuiltExport> {
  const data = await loadExportData(userId, request);
  const { contentType } = EXTENSIONS[request.format];
  const filename = exportFilename(request.format, maintenant);
  const texte = (contenu: string) => Buffer.from(contenu, 'utf8');
  switch (request.format) {
    case 'csv_emails':
      return {
        body: texte(csvEmails(data, request.separator)),
        filename,
        contentType,
        rows: countRows(data),
        skipped: 0,
      };
    case 'csv_companies':
      return {
        body: texte(csvCompanies(data, request.separator)),
        filename,
        contentType,
        rows: countRows(data),
        skipped: 0,
      };
    case 'campaign_mailer': {
      const { content, skipped, rows } = campaignMailerCsv(data);
      return { body: texte(content), filename, contentType, rows, skipped };
    }
    case 'json':
      return {
        body: texte(jsonExport(data, request, maintenant)),
        filename,
        contentType,
        rows: countRows(data),
        skipped: 0,
      };
    case 'xlsx':
      return {
        body: await xlsxExport(data, request, maintenant),
        filename,
        contentType,
        rows: countRows(data),
        skipped: 0,
      };
  }
}

export interface ExportRecord {
  readonly id: string;
  readonly format: string;
  readonly filters: unknown;
  readonly status: string;
  readonly rowCount: number | null;
  readonly filename: string | null;
  readonly error: string | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
  readonly expiresAt: Date | null;
  /** Vrai quand le fichier est encore telechargeable. */
  readonly downloadable: boolean;
}

function versRecord(ligne: {
  id: string;
  format: string;
  filters: unknown;
  status: string;
  row_count: number | null;
  filename: string | null;
  error: string | null;
  storage_key: string | null;
  created_at: Date;
  completed_at: Date | null;
  expires_at: Date | null;
}): ExportRecord {
  return {
    id: ligne.id,
    format: ligne.format,
    filters: ligne.filters,
    status: ligne.status,
    rowCount: ligne.row_count,
    filename: ligne.filename,
    error: ligne.error,
    createdAt: ligne.created_at,
    completedAt: ligne.completed_at,
    expiresAt: ligne.expires_at,
    downloadable:
      ligne.status === 'done' &&
      ligne.storage_key !== null &&
      ligne.expires_at !== null &&
      ligne.expires_at.getTime() > Date.now(),
  };
}

const COLONNES = `id, format, filters, status::text as status, row_count, filename, error,
                  storage_key, created_at, completed_at, expires_at`;

export type ExportOutcome =
  | { readonly kind: 'ready'; readonly exportId: string; readonly file: BuiltExport }
  | { readonly kind: 'queued'; readonly export: ExportRecord };

export async function createExport(
  deps: {
    storage: ExportStorage | undefined;
    enqueue: (exportId: string, userId: string) => Promise<void>;
  },
  userId: string,
  request: ExportRequest,
): Promise<ExportOutcome> {
  const lignes = await countExportRows(userId, request);
  const cree = await query<{ id: string }>(
    `insert into exports (user_id, format, filters, status) values ($1, $2, $3, 'pending') returning id`,
    [userId, request.format, JSON.stringify(request)],
  );
  const exportId = cree.rows[0]?.id ?? '';

  if (lignes <= SYNC_EXPORT_MAX_ROWS) {
    const file = await buildExport(userId, request, new Date());
    // Journalise sans etre garde : le fichier part dans la reponse.
    await query(
      `update exports set status = 'done', row_count = $2, filename = $3, completed_at = now()
        where id = $1`,
      [exportId, file.rows, file.filename],
    );
    return { kind: 'ready', exportId, file };
  }

  if (deps.storage === undefined) {
    await query(
      `update exports set status = 'failed', error = $2, completed_at = now() where id = $1`,
      [exportId, 'Stockage des exports non configure.'],
    );
    throw new AppError({
      status: 503,
      code: 'export_storage_unavailable',
      title: 'Export volumineux indisponible',
      detail: `Plus de ${SYNC_EXPORT_MAX_ROWS.toLocaleString('fr-FR')} adresses : ce volume est produit en arriere-plan, et le stockage des exports n'est pas configure. Reduisez le perimetre ou le filtre.`,
    });
  }
  await deps.enqueue(exportId, userId);
  const lu = await query<Parameters<typeof versRecord>[0]>(
    `select ${COLONNES} from exports where id = $1`,
    [exportId],
  );
  const ligne = lu.rows[0];
  if (ligne === undefined) throw new Error("L'export n'a pas ete enregistre.");
  return { kind: 'queued', export: versRecord(ligne) };
}

/** La tache d'un export volumineux : produit, depose dans le stockage, garde sept jours. */
export async function runExportJob(storage: ExportStorage, exportId: string): Promise<void> {
  const lu = await query<{ user_id: string; filters: unknown; status: string }>(
    `select user_id, filters, status::text as status from exports where id = $1`,
    [exportId],
  );
  const ligne = lu.rows[0];
  // Deja fait, ou efface avec le compte : une tache rejouee ne refait rien.
  if (ligne === undefined || ligne.status === 'done' || ligne.status === 'expired') return;
  await query(`update exports set status = 'running' where id = $1`, [exportId]);
  try {
    const request = exportRequestSchema.parse(ligne.filters);
    const file = await buildExport(ligne.user_id, request, new Date());
    const cle = `exports/${ligne.user_id}/${exportId}.${EXTENSIONS[request.format].ext}`;
    await storage.put(cle, file.body, file.contentType);
    await query(
      `update exports
          set status = 'done', row_count = $2, filename = $3, storage_key = $4,
              completed_at = now(), expires_at = now() + make_interval(days => $5)
        where id = $1`,
      [exportId, file.rows, file.filename, cle, EXPORT_RETENTION_DAYS],
    );
  } catch (error) {
    await query(
      `update exports set status = 'failed', error = $2, completed_at = now() where id = $1`,
      [exportId, "L'export n'a pas pu etre produit."],
    );
    throw error;
  }
}

export async function listExports(userId: string): Promise<ExportRecord[]> {
  const lues = await query<Parameters<typeof versRecord>[0]>(
    `select ${COLONNES} from exports where user_id = $1 order by created_at desc limit 50`,
    [userId],
  );
  return lues.rows.map(versRecord);
}

export async function downloadExport(
  storage: ExportStorage | undefined,
  userId: string,
  id: string,
): Promise<{ body: Buffer; filename: string; contentType: string } | undefined> {
  const lu = await query<Parameters<typeof versRecord>[0]>(
    `select ${COLONNES} from exports where id = $1 and user_id = $2`,
    [id, userId],
  );
  const ligne = lu.rows[0];
  if (ligne === undefined || storage === undefined) return undefined;
  const record = versRecord(ligne);
  if (!record.downloadable || ligne.storage_key === null) return undefined;
  const body = await storage.get(ligne.storage_key);
  if (body === undefined) return undefined;
  const format = exportRequestSchema.shape.format.safeParse(ligne.format);
  return {
    body,
    filename: ligne.filename ?? 'export',
    contentType: format.success ? EXTENSIONS[format.data].contentType : 'application/octet-stream',
  };
}

/** F-1104 : au bout de sept jours, le fichier est efface ; la ligne du journal reste. */
export async function purgeExpiredExports(storage: ExportStorage): Promise<number> {
  const echus = await query<{ id: string; storage_key: string }>(
    `select id, storage_key from exports
      where status = 'done' and storage_key is not null and expires_at <= now()`,
  );
  for (const ligne of echus.rows) {
    await storage.remove(ligne.storage_key);
    await query(`update exports set status = 'expired', storage_key = null where id = $1`, [
      ligne.id,
    ]);
  }
  return echus.rows.length;
}
