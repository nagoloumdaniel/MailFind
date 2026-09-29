import { describe, expect, it } from 'vitest';
import { classifyLocalPart, typeInContext } from './roles.js';

describe('classifyLocalPart (6.8, par prefixe)', () => {
  it('reconnait chaque type par son prefixe', () => {
    expect(classifyLocalPart('recrutement')).toBe('recruitment');
    expect(classifyLocalPart('Jobs')).toBe('recruitment');
    expect(classifyLocalPart('rh.recrutement')).toBe('recruitment');
    expect(classifyLocalPart('drh')).toBe('hr');
    expect(classifyLocalPart('contact')).toBe('generic');
    expect(classifyLocalPart('commercial')).toBe('sales');
    expect(classifyLocalPart('presse')).toBe('press');
    expect(classifyLocalPart('sav')).toBe('support');
  });

  it('lit le premier mot d une adresse composee', () => {
    expect(classifyLocalPart('recrutement.lyon')).toBe('recruitment');
    expect(classifyLocalPart('contact-presse')).toBe('generic');
  });

  it('reconnait une adresse de personne', () => {
    expect(classifyLocalPart('jean.dupont')).toBe('personal');
    expect(classifyLocalPart('j.dupont')).toBe('personal');
  });

  it('ne devine pas le reste', () => {
    expect(classifyLocalPart('bureau42')).toBe('unknown');
    expect(classifyLocalPart('webmaster')).toBe('unknown');
  });
});

describe('typeInContext (6.8, par contexte de page)', () => {
  it('compte pour le recrutement une adresse generique vue sur la page carrieres', () => {
    expect(typeInContext('contact', 'https://acme.fr/nous-rejoindre')).toBe('recruitment');
    expect(typeInContext('bureau', 'https://acme.fr/carrieres/offres')).toBe('recruitment');
  });

  it('garde le type d une adresse vue ailleurs', () => {
    expect(typeInContext('contact', 'https://acme.fr/contact')).toBe('generic');
  });

  it('ne declasse jamais une adresse deja typee autrement', () => {
    expect(typeInContext('presse', 'https://acme.fr/carrieres')).toBe('press');
    expect(typeInContext('jean.dupont', 'https://acme.fr/jobs')).toBe('personal');
  });
});
