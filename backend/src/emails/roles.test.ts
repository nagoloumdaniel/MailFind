import { describe, expect, it } from 'vitest';
import { classifyLocalPart } from './roles.js';

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
