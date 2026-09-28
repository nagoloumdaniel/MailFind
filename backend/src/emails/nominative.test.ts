import { describe, expect, it } from 'vitest';
import { applyPattern, splitName } from './nominative.js';

describe('splitName', () => {
  it('separe prenom et nom, accents et particules replies', () => {
    expect(splitName('Jean-Paul de la Tour')).toEqual({ first: 'jean-paul', last: 'delatour' });
    expect(splitName('Éloïse Dupré')).toEqual({ first: 'eloise', last: 'dupre' });
  });

  it('ne devine rien d un nom seul', () => {
    expect(splitName('Dupont')).toBeUndefined();
    expect(splitName('  ')).toBeUndefined();
  });
});

describe('applyPattern (F-504)', () => {
  const personne = { first: 'jean', last: 'dupont' };

  it('applique les formats annonces par Hunter', () => {
    expect(applyPattern('{first}.{last}', personne, 'acme.fr')).toBe('jean.dupont@acme.fr');
    expect(applyPattern('{f}{last}', personne, 'acme.fr')).toBe('jdupont@acme.fr');
    expect(applyPattern('{first}', personne, 'acme.fr')).toBe('jean@acme.fr');
    expect(applyPattern('{last}_{f}', personne, 'acme.fr')).toBe('dupont_j@acme.fr');
  });

  it('ne produit rien d un format inconnu', () => {
    expect(applyPattern('{first}{middle}', personne, 'acme.fr')).toBeUndefined();
    expect(applyPattern('contact', personne, 'acme.fr')).toBeUndefined();
  });
});
