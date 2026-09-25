import { describe, expect, it } from 'vitest';
import { validateRow } from './validate.js';
import type { KnownField } from './fields.js';

const headers = ['entreprise', 'site', 'carrieres', 'ville', 'etiquettes', 'chiffre affaires'];
const mapping: (KnownField | null)[] = [
  'company_name',
  'website_url',
  'careers_url',
  'city',
  'tags',
  null,
];

describe('validateRow', () => {
  it('accepte une ligne complete et normalise ce qui doit l etre', () => {
    const verdict = validateRow(headers, mapping, [
      'Doctolib SAS',
      'https://www.doctolib.fr/',
      '',
      'Paris',
      'alternance;sante',
      '150M',
    ]);

    expect(verdict.accepted).toBe(true);
    if (!verdict.accepted) return;
    expect(verdict.draft.name).toBe('Doctolib SAS');
    expect(verdict.draft.normalizedName).toBe('doctolib');
    expect(verdict.draft.domain).toBe('doctolib.fr');
    expect(verdict.draft.websiteUrl).toBe('https://www.doctolib.fr');
    expect(verdict.draft.city).toBe('Paris');
    expect(verdict.draft.tags).toEqual(['alternance', 'sante']);
  });

  it('garde les colonnes inconnues comme attributs libres (F-204)', () => {
    const verdict = validateRow(headers, mapping, ['Acme', 'acme.fr', '', '', '', '2,4 M']);
    expect(verdict.accepted).toBe(true);
    if (!verdict.accepted) return;
    expect(verdict.draft.attributes).toEqual({ 'chiffre affaires': '2,4 M' });
  });

  it('deduit le domaine du site quand la colonne domaine est absente', () => {
    const verdict = validateRow(headers, mapping, [
      '',
      'https://agence.example.fr/a-propos',
      '',
      '',
      '',
      '',
    ]);
    expect(verdict.accepted).toBe(true);
    if (!verdict.accepted) return;
    expect(verdict.draft.domain).toBe('agence.example.fr');
  });

  it('accepte une ligne qui n a qu un nom', () => {
    const verdict = validateRow(headers, mapping, ['Startup Sans Site', '', '', 'Nantes', '', '']);
    expect(verdict.accepted).toBe(true);
    if (!verdict.accepted) return;
    expect(verdict.draft.domain).toBeUndefined();
  });

  it('accepte une ligne qui n a qu une page carrieres', () => {
    const verdict = validateRow(headers, mapping, [
      '',
      '',
      'https://jobs.example.fr/offres',
      '',
      '',
      '',
    ]);
    expect(verdict.accepted).toBe(true);
    if (!verdict.accepted) return;
    expect(verdict.draft.careersUrl).toBe('https://jobs.example.fr/offres');
  });

  it('rejette une ligne sans aucun champ identifiant, avec son motif (F-202)', () => {
    const verdict = validateRow(headers, mapping, ['', '', '', 'Toulouse', 'prospection', '2M']);
    expect(verdict.accepted).toBe(false);
    if (verdict.accepted) return;
    expect(verdict.reason).toContain('rien a chercher');
  });

  it('rejette une ligne dont la seule adresse est inexploitable, en la citant', () => {
    const verdict = validateRow(headers, mapping, ['', 'pas une adresse', '', 'Lyon', '', '']);
    expect(verdict.accepted).toBe(false);
    if (verdict.accepted) return;
    expect(verdict.reason).toContain('pas une adresse');
  });

  it('rejette une adresse email glissee dans la colonne site', () => {
    const verdict = validateRow(headers, mapping, ['', 'contact@exemple.fr', '', '', '', '']);
    expect(verdict.accepted).toBe(false);
  });

  it('ne se fie pas a la page pour la validation', () => {
    // Meme si la page a tout accepte, la ligne vide est refusee ici.
    expect(validateRow(headers, mapping, ['', '', '', '', '', '']).accepted).toBe(false);
  });

  it('retire les caracteres de controle', () => {
    const verdict = validateRow(headers, mapping, ['Acme\u0000\u0007', 'acme.fr', '', '', '', '']);
    expect(verdict.accepted).toBe(true);
    if (!verdict.accepted) return;
    expect(verdict.draft.name).toBe('Acme');
  });

  it('tronque une valeur demesuree plutot que de la stocker', () => {
    const verdict = validateRow(headers, mapping, ['A'.repeat(5000), 'acme.fr', '', '', '', '']);
    expect(verdict.accepted).toBe(true);
    if (!verdict.accepted) return;
    expect(verdict.draft.name).toHaveLength(2000);
  });

  it('ignore une seconde colonne attribuee au meme champ', () => {
    const doubles: (KnownField | null)[] = ['company_name', 'company_name'];
    const verdict = validateRow(['a', 'b'], doubles, ['Premier', 'Second']);
    expect(verdict.accepted).toBe(true);
    if (!verdict.accepted) return;
    expect(verdict.draft.name).toBe('Premier');
  });

  it('supporte une ligne plus courte que l en-tete', () => {
    const verdict = validateRow(headers, mapping, ['Acme']);
    expect(verdict.accepted).toBe(true);
  });

  it('garde le SIREN d un SIRET', () => {
    const verdict = validateRow(
      ['entreprise', 'siret'],
      ['company_name', 'siren'],
      ['Doctolib', '79459881300021'],
    );
    expect(verdict.accepted).toBe(true);
    if (!verdict.accepted) return;
    expect(verdict.draft.siren).toBe('794598813');
  });
});
