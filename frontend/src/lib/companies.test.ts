import { describe, expect, it } from 'vitest';
import {
  companyFiltersFromSearch,
  companyFiltersToSearch,
  DEFAULT_COMPANY_FILTERS,
  nextCompanySort,
} from './companies';

describe('filtres de la vue Entreprises dans l adresse', () => {
  it('fait l aller-retour sans perte', () => {
    const filtres = {
      ...DEFAULT_COMPANY_FILTERS,
      q: 'acme',
      city: 'Lyon',
      tag: 'salon',
      crawlStatus: ['failed'],
      hasType: ['recruitment', 'hr'],
      sort: 'emails' as const,
      dir: 'desc' as const,
      page: 2,
    };
    expect(companyFiltersFromSearch(companyFiltersToSearch(filtres))).toEqual(filtres);
    expect(companyFiltersToSearch(DEFAULT_COMPANY_FILTERS).toString()).toBe('');
  });

  it('commence par le plus grand nombre d adresses', () => {
    expect(nextCompanySort(DEFAULT_COMPANY_FILTERS, 'emails')).toMatchObject({ dir: 'desc' });
  });
});
