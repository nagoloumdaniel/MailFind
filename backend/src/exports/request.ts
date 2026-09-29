import { z } from 'zod';

/**
 * Ce qu'un export demande (6.11, F-1101 a F-1105) : un format, un perimetre,
 * un filtre de statut, une adresse par type ou toutes, un separateur.
 */

export const EXPORT_FORMATS = [
  'csv_emails',
  'csv_companies',
  'xlsx',
  'json',
  'campaign_mailer',
] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * F-1102 : `valid` seulement, `valid` et `accept_all` (par defaut), ou tous
 * sauf les statuts toujours exclus (`invalid`, `disposable`, `suppressed`).
 */
export const STATUS_FILTERS = ['valid', 'valid_accept_all', 'all'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const exportRequestSchema = z
  .object({
    format: z.enum(EXPORT_FORMATS),
    // F-1101 : la selection courante, un import, une etiquette ou toute la
    // bibliotheque.
    scope: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('library') }).strict(),
      z.object({ kind: z.literal('import'), importId: z.uuid() }).strict(),
      z.object({ kind: z.literal('tag'), tag: z.string().trim().min(1).max(50) }).strict(),
      z.object({ kind: z.literal('contacts'), ids: z.array(z.uuid()).min(1).max(10_000) }).strict(),
      z
        .object({ kind: z.literal('companies'), ids: z.array(z.uuid()).min(1).max(10_000) })
        .strict(),
    ]),
    statuses: z.enum(STATUS_FILTERS).default('valid_accept_all'),
    // F-1103 : la meilleure adresse par entreprise et par type, ou toutes.
    bestOnly: z.boolean().default(false),
    // F-1105 : le point-virgule par defaut, celui qu'Excel en francais attend.
    separator: z.enum([',', ';']).default(';'),
  })
  .strict();

export type ExportRequest = z.infer<typeof exportRequestSchema>;

/** Les statuts exportes pour chaque filtre. `unverified` n'est jamais dit verifie : il porte son statut. */
export const EXPORTED_STATUSES: Record<StatusFilter, readonly string[]> = {
  valid: ['valid'],
  valid_accept_all: ['valid', 'accept_all'],
  all: ['valid', 'accept_all', 'risky', 'unknown', 'unverified'],
};

/** F-1104 : au-dela, l'export est produit en arriere-plan et garde sept jours. */
export const SYNC_EXPORT_MAX_ROWS = 2000;
export const EXPORT_RETENTION_DAYS = 7;

export const EXTENSIONS: Record<ExportFormat, { ext: string; contentType: string }> = {
  csv_emails: { ext: 'csv', contentType: 'text/csv; charset=utf-8' },
  csv_companies: { ext: 'csv', contentType: 'text/csv; charset=utf-8' },
  campaign_mailer: { ext: 'csv', contentType: 'text/csv; charset=utf-8' },
  json: { ext: 'json', contentType: 'application/json; charset=utf-8' },
  xlsx: {
    ext: 'xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
};

const NOMS: Record<ExportFormat, string> = {
  csv_emails: 'adresses',
  csv_companies: 'entreprises',
  campaign_mailer: 'campaign-mailer',
  json: 'bibliotheque',
  xlsx: 'bibliotheque',
};

export function exportFilename(format: ExportFormat, date: Date): string {
  return `mailfind-${NOMS[format]}-${date.toISOString().slice(0, 10)}.${EXTENSIONS[format].ext}`;
}
