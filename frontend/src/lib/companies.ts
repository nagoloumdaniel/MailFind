import { apiFetch } from './api';
import { PAGE_SIZES, TYPE_FILTERS, type PageSize } from './contacts';
import type { EmailOrigin, EmailStatus } from './imports';

/** Les memes listes fermees que le serveur (`backend/src/companies/query.ts`). */
export const COMPANY_SORTS = ['name', 'domain', 'city', 'emails', 'score', 'created'] as const;
export type CompanySort = (typeof COMPANY_SORTS)[number];

export const CRAWL_STATUSES = ['pending', 'running', 'done', 'failed', 'skipped'] as const;
export type CrawlStatus = (typeof CRAWL_STATUSES)[number];

export const CRAWL_STATUS_LABELS: Record<CrawlStatus, string> = {
  pending: 'En attente',
  running: 'En cours',
  done: 'Exploree',
  failed: 'En echec',
  skipped: 'Non exploree',
};

export interface CompanyFilters {
  q: string;
  city: string;
  country: string;
  industry: string;
  tag: string;
  crawlStatus: string[];
  hasType: string[];
  sort: CompanySort;
  dir: 'asc' | 'desc';
  page: number;
  pageSize: PageSize;
}

export const DEFAULT_COMPANY_FILTERS: CompanyFilters = {
  q: '',
  city: '',
  country: '',
  industry: '',
  tag: '',
  crawlStatus: [],
  hasType: [],
  sort: 'name',
  dir: 'asc',
  page: 1,
  pageSize: 25,
};

export interface CompanySummary {
  id: string;
  name: string;
  domain: string | null;
  domainStatus: string;
  city: string | null;
  country: string | null;
  industry: string | null;
  tags: string[];
  crawlStatus: CrawlStatus;
  emailCount: number;
  validCount: number;
  types: string[];
  bestScore: number | null;
  createdAt: string;
}

export interface CompanyFacets {
  cities: string[];
  countries: string[];
  industries: string[];
  tags: string[];
}

function liste(valeur: string | null, permis: readonly string[]): string[] {
  if (valeur === null) return [];
  return [...new Set(valeur.split(','))].filter((v) => permis.includes(v));
}

export function companyFiltersFromSearch(params: URLSearchParams): CompanyFilters {
  const sort = params.get('sort');
  const taille = Number(params.get('pageSize'));
  const page = Number(params.get('page'));
  return {
    q: params.get('q') ?? '',
    city: params.get('city') ?? '',
    country: params.get('country') ?? '',
    industry: params.get('industry') ?? '',
    tag: params.get('tag') ?? '',
    crawlStatus: liste(params.get('crawlStatus'), CRAWL_STATUSES),
    hasType: liste(params.get('hasType'), TYPE_FILTERS),
    sort: (COMPANY_SORTS as readonly string[]).includes(sort ?? '')
      ? (sort as CompanySort)
      : DEFAULT_COMPANY_FILTERS.sort,
    dir: params.get('dir') === 'desc' ? 'desc' : 'asc',
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: (PAGE_SIZES as readonly number[]).includes(taille)
      ? (taille as PageSize)
      : DEFAULT_COMPANY_FILTERS.pageSize,
  };
}

export function companyFiltersToSearch(filtres: CompanyFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const cle of ['q', 'city', 'country', 'industry', 'tag'] as const) {
    if (filtres[cle] !== '') params.set(cle, filtres[cle]);
  }
  if (filtres.crawlStatus.length > 0) params.set('crawlStatus', filtres.crawlStatus.join(','));
  if (filtres.hasType.length > 0) params.set('hasType', filtres.hasType.join(','));
  if (filtres.sort !== DEFAULT_COMPANY_FILTERS.sort) params.set('sort', filtres.sort);
  if (filtres.dir !== DEFAULT_COMPANY_FILTERS.dir) params.set('dir', filtres.dir);
  if (filtres.page !== 1) params.set('page', String(filtres.page));
  if (filtres.pageSize !== DEFAULT_COMPANY_FILTERS.pageSize) {
    params.set('pageSize', String(filtres.pageSize));
  }
  return params;
}

export function nextCompanySort(filtres: CompanyFilters, colonne: CompanySort): CompanyFilters {
  if (filtres.sort === colonne) {
    return { ...filtres, dir: filtres.dir === 'asc' ? 'desc' : 'asc', page: 1 };
  }
  const descendant = colonne === 'emails' || colonne === 'score' || colonne === 'created';
  return { ...filtres, sort: colonne, dir: descendant ? 'desc' : 'asc', page: 1 };
}

export async function fetchCompanies(
  filtres: CompanyFilters,
): Promise<{ total: number; companies: CompanySummary[] }> {
  return apiFetch(`/api/companies?${companyFiltersToSearch(filtres).toString()}`);
}

export async function fetchCompanyFacets(): Promise<CompanyFacets> {
  return apiFetch('/api/companies/facets');
}

export interface CompanySource {
  kind: string;
  url: string | null;
  provider: string | null;
  method: string | null;
  excerpt: string | null;
  discoveredAt: string;
}

export interface CompanyDetail {
  company: {
    id: string;
    name: string;
    legalName: string | null;
    domain: string | null;
    domainStatus: string;
    domainConfidence: number | null;
    websiteUrl: string | null;
    careersUrl: string | null;
    contactFormUrl: string | null;
    linkedinUrl: string | null;
    phone: string | null;
    siren: string | null;
    city: string | null;
    country: string | null;
    industry: string | null;
    employeeRange: string | null;
    tags: string[];
    notes: string | null;
    crawlStatus: CrawlStatus;
    crawlNotes: string[];
    crawlError: string | null;
    crawledAt: string | null;
    createdAt: string;
  };
  emails: {
    id: string;
    address: string;
    contactName: string | null;
    type: string;
    origin: EmailOrigin;
    status: EmailStatus;
    score: number | null;
    scoreBreakdown: unknown;
    verificationReason: string | null;
    verifiedAt: string | null;
    sources: CompanySource[];
  }[];
  history: {
    importId: string | null;
    filename: string | null;
    step: string;
    status: string;
    error: string | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
  }[];
}

export async function fetchCompany(id: string): Promise<CompanyDetail> {
  return apiFetch(`/api/companies/${encodeURIComponent(id)}`);
}

export async function updateCompany(
  id: string,
  patch: { notes?: string | null; tags?: string[] },
): Promise<CompanyDetail> {
  return apiFetch(`/api/companies/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function correctDomain(
  id: string,
  domain: string,
): Promise<CompanyDetail & { importId: string }> {
  return apiFetch(`/api/companies/${encodeURIComponent(id)}/domain`, {
    method: 'POST',
    body: JSON.stringify({ domain }),
  });
}

export const DOMAIN_STATUS_LABELS: Record<string, string> = {
  unknown: 'inconnu',
  provided: 'fourni dans le fichier',
  confirmed: 'confirme',
  to_confirm: 'a confirmer',
};

export const STEP_LABELS: Record<string, string> = {
  identify: 'Identification',
  crawl: 'Exploration du site',
  enrich: 'Recherche complementaire',
  verify: 'Verification et score',
};

export const STEP_STATUS_LABELS: Record<string, string> = {
  pending: 'en attente',
  running: 'en cours',
  done: 'terminee',
  failed: 'en echec',
  skipped: 'sans objet',
};
