import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, filtersFromSearch, filtersToSearch, nextSort } from './contacts';

describe('filtres de la page Contacts dans l adresse', () => {
  it('fait l aller-retour sans perte', () => {
    const filtres = {
      ...DEFAULT_FILTERS,
      q: 'acme',
      status: ['valid', 'risky'],
      type: ['hr'],
      sort: 'score' as const,
      dir: 'desc' as const,
      page: 3,
      pageSize: 50 as const,
    };
    expect(filtersFromSearch(filtersToSearch(filtres))).toEqual(filtres);
  });

  it('garde une adresse courte avec les valeurs par defaut', () => {
    expect(filtersToSearch(DEFAULT_FILTERS).toString()).toBe('');
  });

  it('ignore ce qui n est pas reconnu', () => {
    const lu = filtersFromSearch(
      new URLSearchParams('status=valid,verified&sort=x&pageSize=7&page=-2'),
    );
    expect(lu).toMatchObject({ status: ['valid'], sort: 'company', pageSize: 25, page: 1 });
  });
});

describe('nextSort', () => {
  it('inverse le sens sur la meme colonne et revient a la premiere page', () => {
    const trie = nextSort({ ...DEFAULT_FILTERS, page: 4 }, 'company');
    expect(trie).toMatchObject({ sort: 'company', dir: 'desc', page: 1 });
  });

  it('commence par le plus haut score', () => {
    expect(nextSort(DEFAULT_FILTERS, 'score')).toMatchObject({ sort: 'score', dir: 'desc' });
    expect(nextSort(DEFAULT_FILTERS, 'address')).toMatchObject({ sort: 'address', dir: 'asc' });
  });
});
