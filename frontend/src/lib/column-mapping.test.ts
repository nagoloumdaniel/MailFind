import { describe, expect, it } from 'vitest';
import {
  describeRow,
  freeColumns,
  mappingCanIdentify,
  normalizeHeader,
  suggestMapping,
} from './column-mapping';

describe('normalizeHeader', () => {
  it('ignore la casse, les accents et la ponctuation', () => {
    expect(normalizeHeader("Nom de l'entreprise")).toBe('nom de l entreprise');
    expect(normalizeHeader('NOM_DE_L_ENTREPRISE')).toBe('nom de l entreprise');
    expect(normalizeHeader('  Société  ')).toBe('societe');
  });
});

describe('suggestMapping', () => {
  it('reconnait les en-tetes francais', () => {
    expect(suggestMapping(['entreprise', 'domaine', 'ville', 'etiquettes'])).toEqual([
      'company_name',
      'domain',
      'city',
      'tags',
    ]);
  });

  it('reconnait les en-tetes anglais', () => {
    expect(suggestMapping(['company', 'website', 'careers', 'city'])).toEqual([
      'company_name',
      'website_url',
      'careers_url',
      'city',
    ]);
  });

  it('reconnait un fichier melangeant les deux langues', () => {
    expect(suggestMapping(['Société', 'domain', 'Ville', 'notes'])).toEqual([
      'company_name',
      'domain',
      'city',
      'notes',
    ]);
  });

  it("laisse non reconnue une colonne qu'il ne connait pas", () => {
    expect(suggestMapping(['entreprise', 'chiffre affaires 2025'])).toEqual(['company_name', null]);
  });

  it("n'attribue pas deux fois le meme champ", () => {
    // La seconde colonne « site » deviendra un attribut libre plutot que
    // d'ecraser la premiere.
    expect(suggestMapping(['site', 'site web'])).toEqual(['website_url', null]);
  });

  it('ignore une colonne sans en-tete', () => {
    expect(suggestMapping(['entreprise', '  '])).toEqual(['company_name', null]);
  });

  it("lit l'en-tete de l'annexe A du cahier des charges", () => {
    expect(suggestMapping(['entreprise', 'site', 'carrieres', 'ville', 'etiquettes'])).toEqual([
      'company_name',
      'website_url',
      'careers_url',
      'city',
      'tags',
    ]);
  });
});

describe('freeColumns', () => {
  it('rend les colonnes gardees comme attributs libres (F-204)', () => {
    const headers = ['entreprise', 'chiffre affaires', 'effectif 2025'];
    expect(freeColumns(headers, suggestMapping(headers))).toEqual([
      'chiffre affaires',
      'effectif 2025',
    ]);
  });
});

describe('mappingCanIdentify', () => {
  it('accepte un fichier qui porte un seul des quatre champs identifiants', () => {
    expect(mappingCanIdentify(['careers_url', 'city'])).toBe(true);
  });

  it('refuse un fichier sans aucun champ identifiant', () => {
    expect(mappingCanIdentify(['city', 'notes', null])).toBe(false);
  });
});

describe('describeRow', () => {
  const headers = ['entreprise', 'site', 'ville', 'chiffre affaires'];
  const mapping = suggestMapping(headers);

  it('range les valeurs sous leur champ', () => {
    const vue = describeRow(headers, mapping, ['Doctolib', 'doctolib.fr', 'Paris', '150M'], 2);

    expect(vue.values).toEqual({
      company_name: 'Doctolib',
      website_url: 'doctolib.fr',
      city: 'Paris',
    });
    expect(vue.rejection).toBeUndefined();
  });

  it('garde la colonne inconnue comme attribut libre', () => {
    const vue = describeRow(headers, mapping, ['Doctolib', 'doctolib.fr', 'Paris', '150M'], 2);
    expect(vue.attributes).toEqual({ 'chiffre affaires': '150M' });
  });

  it('accepte une ligne sans nom mais avec un domaine', () => {
    const vue = describeRow(headers, mapping, ['', 'agence-web-exemple.fr', 'Bordeaux', ''], 5);
    expect(vue.rejection).toBeUndefined();
    expect(vue.values.website_url).toBe('agence-web-exemple.fr');
  });

  it('accepte une ligne sans site mais avec un nom', () => {
    const vue = describeRow(headers, mapping, ['Startup Sans Site', '', 'Nantes', ''], 4);
    expect(vue.rejection).toBeUndefined();
  });

  it('rejette une ligne qui ne porte que des champs secondaires, avec son motif', () => {
    const vue = describeRow(headers, mapping, ['', '', 'Bordeaux', '2M'], 7);

    expect(vue.rejection).toBeDefined();
    expect(vue.rejection).toContain('rien a chercher');
    expect(vue.line).toBe(7);
  });

  it('rejette une ligne entierement vide', () => {
    expect(describeRow(headers, mapping, ['', '', '', ''], 9).rejection).toBeDefined();
  });

  it('ignore les cellules en trop par rapport a l en-tete', () => {
    const vue = describeRow(headers, mapping, ['Acme', 'acme.fr', 'Lyon', '1M', 'en trop'], 3);
    expect(vue.values.company_name).toBe('Acme');
    expect(Object.keys(vue.attributes)).toEqual(['chiffre affaires']);
  });

  it('supporte une ligne plus courte que l en-tete', () => {
    const vue = describeRow(headers, mapping, ['Acme'], 3);
    expect(vue.values).toEqual({ company_name: 'Acme' });
    expect(vue.rejection).toBeUndefined();
  });
});
