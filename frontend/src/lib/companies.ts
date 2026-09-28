import { apiFetch } from './api';
import { PAGE_SIZES, TYPE_FILTERS, type PageSize } from './contacts';

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
