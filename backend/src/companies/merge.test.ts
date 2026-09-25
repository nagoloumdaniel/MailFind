import { describe, expect, it } from 'vitest';
import { mergeDraft, type ExistingCompany } from './merge.js';
import type { CompanyDraft } from '../imports/validate.js';

const existante: ExistingCompany = {
  id: 'c1',
  name: 'Doctolib',
  normalizedName: 'doctolib',
  domain: 'doctolib.fr',
  websiteUrl: 'https://doctolib.fr',
  careersUrl: null,
  siren: null,
  city: 'Paris',
  country: null,
  industry: null,
  notes: null,
  tags: ['alternance'],
  attributes: { 'chiffre affaires': '150M' },
};

function brouillon(partiel: Partial<CompanyDraft> = {}): CompanyDraft {
  return {
    name: 'Doctolib',
    normalizedName: 'doctolib',
    domain: undefined,
    websiteUrl: undefined,
    careersUrl: undefined,
    siren: undefined,
    city: undefined,
    country: undefined,
    industry: undefined,
    contactName: undefined,
    tags: [],
    notes: undefined,
    attributes: {},
    ...partiel,
  };
}

describe('mergeDraft', () => {
  it('ne propose rien quand la ligne n apporte rien', () => {
    expect(mergeDraft(existante, brouillon())).toEqual({});
  });

  it('complete un champ qui manquait', () => {
    expect(mergeDraft(existante, brouillon({ siren: '794598813' }))).toEqual({
      siren: '794598813',
    });
  });

  it("n'ecrase pas un champ deja rempli", () => {
    // La seconde ligne n'a aucune raison d'etre plus juste que la premiere.
    expect(mergeDraft(existante, brouillon({ city: 'Lyon', domain: 'autre.fr' }))).toEqual({});
  });

  it('additionne les etiquettes', () => {
    const patch = mergeDraft(existante, brouillon({ tags: ['sante', 'alternance'] }));
    expect(patch.tags).toEqual(['alternance', 'sante']);
  });

  it('ne touche pas aux etiquettes quand elles sont deja toutes la', () => {
    expect(mergeDraft(existante, brouillon({ tags: ['alternance'] }))).toEqual({});
  });

  it('ajoute un attribut libre inconnu sans toucher aux autres', () => {
    const patch = mergeDraft(existante, brouillon({ attributes: { effectif: '900' } }));
    expect(patch.attributes).toEqual({ 'chiffre affaires': '150M', effectif: '900' });
  });

  it("n'ecrase pas un attribut libre deja connu", () => {
    expect(mergeDraft(existante, brouillon({ attributes: { 'chiffre affaires': '0' } }))).toEqual(
      {},
    );
  });

  it('cumule plusieurs apports en une seule ecriture', () => {
    const patch = mergeDraft(
      existante,
      brouillon({ siren: '794598813', country: 'France', tags: ['sante'] }),
    );

    expect(patch).toEqual({
      siren: '794598813',
      country: 'France',
      tags: ['alternance', 'sante'],
    });
  });
});
