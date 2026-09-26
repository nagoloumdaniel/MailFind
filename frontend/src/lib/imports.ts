import { apiFetch } from './api';
import type { KnownField } from './column-mapping';
import type { ImportSettings } from './import-settings';

/** Ce que l'API rend d'un import (`backend/src/imports/repository.ts`). */
export type ImportStatus =
  'pending' | 'planning' | 'running' | 'cancelled' | 'completed' | 'failed';

export interface ImportSummary {
  id: string;
  filename: string;
  status: ImportStatus;
  totalRows: number;
  processedRows: number;
  /** Lignes exploitables, nouvelles ou rattachees a une entreprise connue. */
  acceptedRows: number;
  /** Parmi elles, celles qui ont rejoint une entreprise deja connue. */
  duplicateRows: number;
  rejectedRows: number;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface RejectedRow {
  line: number;
  error: string;
}

export async function createImport(input: {
  filename: string;
  headers: readonly string[];
  mapping: readonly (KnownField | null)[];
  rows: readonly (readonly string[])[];
  settings: ImportSettings;
}): Promise<ImportSummary> {
  const { import: cree } = await apiFetch<{ import: ImportSummary }>('/api/imports', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return cree;
}

export async function fetchImport(
  id: string,
): Promise<{ import: ImportSummary; rejectedRows: RejectedRow[] }> {
  return apiFetch(`/api/imports/${encodeURIComponent(id)}`);
}

export async function fetchImports(): Promise<ImportSummary[]> {
  const { imports } = await apiFetch<{ imports: ImportSummary[] }>('/api/imports');
  return imports;
}

export async function cancelImport(id: string): Promise<ImportSummary> {
  const { import: annule } = await apiFetch<{ import: ImportSummary }>(
    `/api/imports/${encodeURIComponent(id)}/cancel`,
    { method: 'POST' },
  );
  return annule;
}

/** Tant que l'import est dans l'un de ces etats, quelque chose le fait avancer. */
export function isInProgress(status: ImportStatus): boolean {
  return status === 'pending' || status === 'planning' || status === 'running';
}

export const STATUS_LABELS: Record<ImportStatus, string> = {
  pending: 'En attente',
  planning: 'Preparation',
  running: 'En cours',
  cancelled: 'Annule',
  completed: 'Termine',
  failed: 'En echec',
};
