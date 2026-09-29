import { apiFetch, apiRequest } from './api';

/** Les memes listes que le serveur (`backend/src/exports/request.ts`). */
export const EXPORT_FORMATS = [
  'csv_emails',
  'csv_companies',
  'xlsx',
  'json',
  'campaign_mailer',
] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const FORMAT_LABELS: Record<ExportFormat, { label: string; description: string }> = {
  csv_emails: {
    label: 'CSV, une ligne par adresse',
    description:
      "Colonnes de l'entreprise puis de l'adresse, avec sa source. Pour un tableur ou un CRM.",
  },
  csv_companies: {
    label: 'CSV, une ligne par entreprise',
    description: 'La meilleure adresse, puis celles de recrutement, RH et generiques.',
  },
  xlsx: {
    label: 'Excel (XLSX)',
    description: 'Quatre onglets : Entreprises, Adresses, Sources, Synthese.',
  },
  json: {
    label: 'JSON',
    description: 'Entreprises, leurs adresses, leurs sources et leur verification.',
  },
  campaign_mailer: {
    label: 'Campaign Mailer',
    description:
      'Les quatre colonnes que son import reconnait. Une adresse une fois, et seulement celles que Campaign Mailer accepte.',
  },
};

export const STATUS_FILTERS = ['valid', 'valid_accept_all', 'all'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  valid: 'Valides seulement',
  valid_accept_all: 'Valides et domaines qui acceptent tout',
  all: 'Toutes, sauf invalides, jetables et supprimees',
};

export type ExportScope =
  | { kind: 'library' }
  | { kind: 'import'; importId: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'contacts'; ids: string[] }
  | { kind: 'companies'; ids: string[] };

export interface ExportRequest {
  format: ExportFormat;
  scope: ExportScope;
  statuses: StatusFilter;
  bestOnly: boolean;
  separator: ',' | ';';
}

export interface ExportRecord {
  id: string;
  format: ExportFormat;
  status: 'pending' | 'running' | 'done' | 'failed' | 'expired';
  rowCount: number | null;
  filename: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  downloadable: boolean;
}

export type ExportResult =
  | { kind: 'file'; rows: number; skipped: number; filename: string }
  | { kind: 'queued'; export: ExportRecord };

/** Le nom du fichier annonce par le serveur, ou un nom neutre. */
export function filenameFrom(disposition: string | null): string {
  const trouve = /filename="([^"]+)"/.exec(disposition ?? '');
  return trouve?.[1] ?? 'mailfind-export';
}

function enregistrer(blob: Blob, nom: string) {
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nom;
  lien.click();
  URL.revokeObjectURL(url);
}

/**
 * Jusqu'a 2 000 adresses, le fichier arrive dans la reponse et part tout de
 * suite au telechargement ; au-dela, l'export est prepare en arriere-plan.
 */
export async function createExport(request: ExportRequest): Promise<ExportResult> {
  const response = await apiRequest('/api/exports', {
    method: 'POST',
    body: JSON.stringify(request),
  });
  if (response.status === 202) {
    const { export: exporte } = (await response.json()) as { export: ExportRecord };
    return { kind: 'queued', export: exporte };
  }
  const nom = filenameFrom(response.headers.get('content-disposition'));
  enregistrer(await response.blob(), nom);
  return {
    kind: 'file',
    rows: Number(response.headers.get('x-export-rows') ?? 0),
    skipped: Number(response.headers.get('x-export-skipped') ?? 0),
    filename: nom,
  };
}

export async function fetchExports(): Promise<ExportRecord[]> {
  const { exports } = await apiFetch<{ exports: ExportRecord[] }>('/api/exports');
  return exports;
}

export async function downloadExport(record: ExportRecord): Promise<void> {
  const response = await apiRequest(`/api/exports/${encodeURIComponent(record.id)}/download`);
  enregistrer(
    await response.blob(),
    record.filename ?? filenameFrom(response.headers.get('content-disposition')),
  );
}
