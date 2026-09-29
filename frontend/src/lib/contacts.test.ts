import { describe, expect, it } from 'vitest';
import {
  contactPatch,
  DEFAULT_FILTERS,
  filtersFromSearch,
  filtersToSearch,
  nextSort,
} from './contacts';

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

describe('contactPatch', () => {
  const avant = {
    id: 'c1',
    address: 'rh@acme.fr',
    contactName: null,
    salutation: 'Madame, Monsieur',
    tags: ['lyon'],
    company: { id: 'k1', name: 'Acme', domain: 'acme.fr' },
    type: 'hr',
    origin: 'found' as const,
    status: 'unverified' as const,
    score: 55,
    scoreBreakdown: null,
    excluded: false,
    excludedReason: null,
    verificationReason: null,
    verifiedAt: null,
    createdAt: '2026-09-28T00:00:00Z',
    source: null,
  };

  it('n envoie que ce qui a change, et pas l adresse si seule sa casse bouge', () => {
    expect(
      contactPatch(avant, {
        address: 'RH@acme.fr ',
        companyId: 'k1',
        contactName: 'Julie',
        salutation: 'Madame, Monsieur',
        type: 'hr',
        tags: ['lyon'],
      }),
    ).toEqual({ contactName: 'Julie' });
  });

  it('envoie une adresse corrigee et une autre entreprise', () => {
    expect(contactPatch(avant, { address: 'jobs@acme.fr', companyId: 'k2' })).toEqual({
      address: 'jobs@acme.fr',
      companyId: 'k2',
    });
  });
});
