import { apiFetch } from './api';
import type { EmailOrigin, EmailStatus } from './imports';

/** Les memes listes fermees que le serveur (`backend/src/contacts/query.ts`). */
export const CONTACT_SORTS = [
  'company',
  'name',
  'address',
  'type',
  'status',
  'score',
  'origin',
  'created',
] as const;
export type ContactSort = (typeof CONTACT_SORTS)[number];

export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export const STATUS_FILTERS: EmailStatus[] = [
  'valid',
  'accept_all',
  'risky',
  'unknown',
  'unverified',
  'invalid',
  'disposable',
  'suppressed',
];
export const TYPE_FILTERS = [
  'recruitment',
  'hr',
  'generic',
  'sales',
  'press',
  'support',
  'personal',
  'unknown',
] as const;
export const ORIGIN_FILTERS: EmailOrigin[] = ['found', 'provider', 'deduced', 'imported', 'manual'];

export interface ContactFilters {
  q: string;
  status: string[];
  type: string[];
  origin: string[];
  tag: string;
  companyId: string;
  sort: ContactSort;
  dir: 'asc' | 'desc';
  page: number;
  pageSize: PageSize;
}

export const DEFAULT_FILTERS: ContactFilters = {
  q: '',
  status: [],
  type: [],
  origin: [],
  tag: '',
  companyId: '',
  sort: 'company',
  dir: 'asc',
  page: 1,
  pageSize: 25,
};

export interface Contact {
  id: string;
  address: string;
  contactName: string | null;
  salutation: string | null;
  tags: string[];
  company: { id: string; name: string; domain: string | null };
  type: string;
  origin: EmailOrigin;
  status: EmailStatus;
  score: number | null;
  scoreBreakdown: unknown;
  excluded: boolean;
  excludedReason: string | null;
  verificationReason: string | null;
  verifiedAt: string | null;
  createdAt: string;
  source: { kind: string; url: string | null; provider: string | null } | null;
}

function liste(valeur: string | null, permis: readonly string[]): string[] {
  if (valeur === null) return [];
  return [...new Set(valeur.split(','))].filter((v) => permis.includes(v));
}

/**
 * Les filtres vivent dans l'adresse de la page : un lien partage, un retour
 * arriere ou un rechargement retrouvent la meme liste. Une valeur inconnue est
 * ignoree plutot que de casser la page.
 */
export function filtersFromSearch(params: URLSearchParams): ContactFilters {
  const sort = params.get('sort');
  const taille = Number(params.get('pageSize'));
  const page = Number(params.get('page'));
  return {
    q: params.get('q') ?? '',
    status: liste(params.get('status'), STATUS_FILTERS),
    type: liste(params.get('type'), TYPE_FILTERS),
    origin: liste(params.get('origin'), ORIGIN_FILTERS),
    tag: params.get('tag') ?? '',
    companyId: params.get('companyId') ?? '',
    sort: (CONTACT_SORTS as readonly string[]).includes(sort ?? '')
      ? (sort as ContactSort)
      : DEFAULT_FILTERS.sort,
    dir: params.get('dir') === 'desc' ? 'desc' : 'asc',
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: (PAGE_SIZES as readonly number[]).includes(taille)
      ? (taille as PageSize)
      : DEFAULT_FILTERS.pageSize,
  };
}

/** L'inverse, sans les valeurs par defaut : l'adresse reste courte. */
export function filtersToSearch(filtres: ContactFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filtres.q !== '') params.set('q', filtres.q);
  if (filtres.status.length > 0) params.set('status', filtres.status.join(','));
  if (filtres.type.length > 0) params.set('type', filtres.type.join(','));
  if (filtres.origin.length > 0) params.set('origin', filtres.origin.join(','));
  if (filtres.tag !== '') params.set('tag', filtres.tag);
  if (filtres.companyId !== '') params.set('companyId', filtres.companyId);
  if (filtres.sort !== DEFAULT_FILTERS.sort) params.set('sort', filtres.sort);
  if (filtres.dir !== DEFAULT_FILTERS.dir) params.set('dir', filtres.dir);
  if (filtres.page !== 1) params.set('page', String(filtres.page));
  if (filtres.pageSize !== DEFAULT_FILTERS.pageSize)
    params.set('pageSize', String(filtres.pageSize));
  return params;
}

/**
 * Un clic sur l'en-tete trie par cette colonne ; un second clic inverse le
 * sens. Le score et la date commencent par le plus haut, le plus recent :
 * c'est ce qu'on cherche en cliquant.
 */
export function nextSort(filtres: ContactFilters, colonne: ContactSort): ContactFilters {
  if (filtres.sort === colonne) {
    return { ...filtres, dir: filtres.dir === 'asc' ? 'desc' : 'asc', page: 1 };
  }
  const descendant = colonne === 'score' || colonne === 'created';
  return { ...filtres, sort: colonne, dir: descendant ? 'desc' : 'asc', page: 1 };
}

export async function fetchContacts(
  filtres: ContactFilters,
): Promise<{ total: number; contacts: Contact[] }> {
  return apiFetch(
    `/api/contacts?${filtersToSearch({ ...filtres, pageSize: filtres.pageSize }).toString()}`,
  );
}

export interface ContactInput {
  address?: string;
  companyId?: string;
  newCompany?: { name: string; domain?: string };
  contactName?: string | null;
  salutation?: string | null;
  type?: string;
  tags?: string[];
}

export async function createContact(input: ContactInput): Promise<Contact> {
  const { contact } = await apiFetch<{ contact: Contact }>('/api/contacts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return contact;
}

export async function updateContact(id: string, input: ContactInput): Promise<Contact> {
  const { contact } = await apiFetch<{ contact: Contact }>(
    `/api/contacts/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
  return contact;
}

export interface CompanyChoice {
  id: string;
  name: string;
  domain: string | null;
}

export async function lookupCompanies(q: string): Promise<CompanyChoice[]> {
  const { companies } = await apiFetch<{ companies: CompanyChoice[] }>(
    `/api/companies/lookup?${new URLSearchParams({ q }).toString()}`,
  );
  return companies;
}

/**
 * Ce qui a change dans le formulaire, et seulement cela : une modification
 * n'envoie pas l'adresse si elle n'a pas bouge, pour ne pas relancer la
 * verification sans raison.
 */
export function contactPatch(avant: Contact, apres: ContactInput): ContactInput {
  const patch: ContactInput = {};
  if (
    apres.address !== undefined &&
    apres.address.trim().toLowerCase() !== avant.address.toLowerCase()
  ) {
    patch.address = apres.address.trim();
  }
  if (apres.companyId !== undefined && apres.companyId !== avant.company.id) {
    patch.companyId = apres.companyId;
  }
  if (apres.newCompany !== undefined) patch.newCompany = apres.newCompany;
  // Absent veut dire « inchange » ; vide veut dire « efface ».
  if (apres.contactName !== undefined && apres.contactName !== avant.contactName) {
    patch.contactName = apres.contactName;
  }
  if (apres.salutation !== undefined && apres.salutation !== avant.salutation) {
    patch.salutation = apres.salutation;
  }
  if (apres.type !== undefined && apres.type !== avant.type) patch.type = apres.type;
  if (apres.tags !== undefined && apres.tags.join(',') !== avant.tags.join(','))
    patch.tags = apres.tags;
  return patch;
}

export async function deleteContacts(
  ids: string[],
  suppress: boolean,
): Promise<{ deleted: number; suppressed: number }> {
  return apiFetch('/api/contacts/delete', {
    method: 'POST',
    body: JSON.stringify({ ids, suppress }),
  });
}

export type BulkAction =
  | { action: 'type'; type: string }
  | { action: 'tag' | 'untag'; tags: string[] }
  | { action: 'exclude' | 'include' | 'verify' | 'reverify' };

/** Au-dela, le serveur refuse une verification en masse (`BULK_VERIFY_MAX`). */
export const BULK_VERIFY_MAX = 200;

export async function bulkContacts(
  ids: string[],
  action: BulkAction,
): Promise<{ updated: number; notes: string[] }> {
  return apiFetch('/api/contacts/bulk', {
    method: 'POST',
    body: JSON.stringify({ ids, ...action }),
  });
}
