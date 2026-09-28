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

export interface StepCounts {
  pending: number;
  running: number;
  done: number;
  failed: number;
  skipped: number;
}

export type CrawlNote =
  | 'robots_disallowed'
  | 'masked_address'
  | 'dynamic_content'
  | 'contact_form'
  | 'no_website'
  | 'unreachable';

export interface CompanyIssue {
  id: string;
  name: string;
  domain: string | null;
  domainStatus: 'unknown' | 'provided' | 'confirmed' | 'to_confirm';
  domainConfidence: number | null;
  crawlStatus: string;
  notes: CrawlNote[];
  error: string | null;
}

/** Section 6.7 : un statut, jamais une promesse. */
export type EmailStatus =
  | 'valid'
  | 'accept_all'
  | 'risky'
  | 'unknown'
  | 'invalid'
  | 'disposable'
  | 'suppressed'
  | 'unverified';

export const EMAIL_STATUS_LABELS: Record<EmailStatus, string> = {
  valid: 'Valide',
  accept_all: 'Domaine accepte tout',
  risky: 'Risquee',
  unknown: 'Inconnue',
  invalid: 'Invalide',
  disposable: 'Jetable',
  suppressed: 'Supprimee',
  unverified: 'Non verifiee',
};

export interface ImportProgress {
  companies: number;
  identify: StepCounts;
  crawl: StepCounts;
  enrich: StepCounts;
  verify: StepCounts;
  emails: number;
  emailsByOrigin: { found: number; provider: number; deduced: number };
  emailsByStatus: Partial<Record<EmailStatus, number>>;
  issues: CompanyIssue[];
}

export async function fetchImport(id: string): Promise<{
  import: ImportSummary;
  rejectedRows: RejectedRow[];
  progress: ImportProgress;
}> {
  return apiFetch(`/api/imports/${encodeURIComponent(id)}`);
}

/** Une etape est finie pour une entreprise quand elle ne l'attend plus. */
export function finished(etape: StepCounts): number {
  return etape.done + etape.failed + etape.skipped;
}

export function total(etape: StepCounts): number {
  return finished(etape) + etape.pending + etape.running;
}

/**
 * Ce que la collecte a constate, dit a l'utilisateur. Le formulaire de
 * contact n'y figure pas seul : c'est un canal, pas un probleme.
 */
export const NOTE_LABELS: Record<CrawlNote, string> = {
  robots_disallowed: 'robots.txt interdit la visite de tout ou partie du site',
  unreachable: 'Site injoignable',
  dynamic_content: 'Site construit en JavaScript, contenu non analyse',
  masked_address: 'Adresse masquee par le site, non decodee : formulaire de contact a utiliser',
  contact_form: 'Formulaire de contact disponible',
  no_website: 'Aucun site connu',
};

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
