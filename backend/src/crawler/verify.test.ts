import { describe, expect, it } from 'vitest';
import { appearsIn } from './verify.js';

describe('appearsIn', () => {
  it('retrouve une adresse telle quelle, sans tenir compte de la casse', () => {
    expect(appearsIn('<p>Ecrire a Contact@Acme.fr</p>', 'contact@acme.fr')).toBe(true);
  });

  it('retrouve une adresse encodee dans un lien', () => {
    expect(appearsIn('<a href="mailto:rh%40acme.fr">RH</a>', 'rh@acme.fr')).toBe(true);
  });

  it('retrouve une forme ecrite', () => {
    expect(appearsIn('<p>recrutement [at] acme [point] fr</p>', 'recrutement@acme.fr')).toBe(true);
  });

  it('ne se contente pas de mots epars dans la page', () => {
    const page = `<p>contact</p>${'<p>texte sans rapport</p>'.repeat(20)}<p>acme</p><p>fr</p>`;
    expect(appearsIn(page, 'contact@acme.fr')).toBe(false);
  });

  it('dit absente une adresse qui n y est pas', () => {
    expect(appearsIn('<p>info@autre.fr</p>', 'contact@acme.fr')).toBe(false);
  });
});
