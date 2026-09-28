import { describe, expect, it } from 'vitest';
import { generateCandidates, hasMx } from './candidates.js';

describe('generateCandidates (F-501, F-505)', () => {
  it('propose d abord le prefixe le plus frequent de chaque type manquant', () => {
    const candidates = generateCandidates({
      domain: 'acme.fr',
      wantedTypes: ['recruitment', 'hr', 'generic'],
      foundTypes: new Set(),
    });
    expect(candidates.map((c) => c.address)).toEqual([
      'recrutement@acme.fr',
      'rh@acme.fr',
      'contact@acme.fr',
      'jobs@acme.fr',
      'hr@acme.fr',
    ]);
  });

  it('ne propose rien pour un type deja trouve', () => {
    const candidates = generateCandidates({
      domain: 'acme.fr',
      wantedTypes: ['recruitment', 'generic'],
      foundTypes: new Set(['generic']),
    });
    expect(candidates.every((c) => c.type === 'recruitment')).toBe(true);
  });

  it('ne propose rien quand tous les types recherches sont trouves', () => {
    expect(
      generateCandidates({
        domain: 'acme.fr',
        wantedTypes: ['hr'],
        foundTypes: new Set(['hr', 'generic']),
      }),
    ).toEqual([]);
  });

  it('ne depasse jamais cinq candidates (F-505)', () => {
    const candidates = generateCandidates({
      domain: 'acme.fr',
      wantedTypes: ['recruitment', 'hr', 'generic', 'sales', 'press'],
      foundTypes: new Set(),
    });
    expect(candidates).toHaveLength(5);
  });

  it('ne repropose pas une adresse deja connue', () => {
    const candidates = generateCandidates({
      domain: 'acme.fr',
      wantedTypes: ['generic'],
      foundTypes: new Set(),
      existing: new Set(['contact@acme.fr']),
    });
    expect(candidates.map((c) => c.address)).toEqual([
      'hello@acme.fr',
      'bonjour@acme.fr',
      'info@acme.fr',
    ]);
  });
});

describe('hasMx (F-502)', () => {
  const erreur = (code: string) => Object.assign(new Error(code), { code });

  it('dit oui a un domaine qui a un serveur de messagerie', async () => {
    expect(
      await hasMx('acme.fr', () => Promise.resolve([{ exchange: 'mx.acme.fr', priority: 10 }])),
    ).toBe('yes');
  });

  it('dit non a un MX nul (RFC 7505) et a un domaine sans MX', async () => {
    expect(await hasMx('acme.fr', () => Promise.resolve([{ exchange: '.', priority: 0 }]))).toBe(
      'no',
    );
    expect(await hasMx('acme.fr', () => Promise.reject(erreur('ENODATA')))).toBe('no');
    expect(await hasMx('acme.fr', () => Promise.reject(erreur('ENOTFOUND')))).toBe('no');
  });

  it('ne conclut rien d une panne de resolution', async () => {
    expect(await hasMx('acme.fr', () => Promise.reject(erreur('ETIMEOUT')))).toBe('unknown');
  });
});
