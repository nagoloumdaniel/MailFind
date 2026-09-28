import { describe, expect, it } from 'vitest';
import type { FoundAddress } from './extract.js';
import { filterAddresses } from './filter.js';

function trouvee(address: string): FoundAddress {
  return { address, normalized: address.toLowerCase(), method: 'text', excerpt: address };
}

const garder = (adresses: string[], confirmes: string[] = []) =>
  filterAddresses(adresses.map(trouvee), {
    companyDomain: 'acme.fr',
    confirmedDomains: new Set(confirmes),
  });

describe('filterAddresses (F-410)', () => {
  it('garde les adresses du domaine de l entreprise et de ses sous-domaines', () => {
    const { kept } = garder(['contact@acme.fr', 'rh@groupe.acme.fr']);
    expect(kept.map((a) => a.address)).toEqual(['contact@acme.fr', 'rh@groupe.acme.fr']);
  });

  it('ecarte les adresses d exemple', () => {
    const { kept, rejected } = garder([
      'vous@example.com',
      'prenom.nom@acme.fr',
      'votre.email@exemple.fr',
      'john.doe@acme.fr',
    ]);
    expect(kept).toEqual([]);
    expect(new Set(rejected.map((r) => r.reason))).toEqual(new Set(['example']));
  });

  it('ecarte les fichiers images nommes comme des adresses', () => {
    const { kept, rejected } = garder(['logo@2x.png', 'hero@3x.webp']);
    expect(kept).toEqual([]);
    expect(rejected.every((r) => r.reason === 'file_name')).toBe(true);
  });

  it('ecarte les adresses de prestataires : hebergeur, agence, outil', () => {
    const { kept, rejected } = garder(
      [
        'support@ovh.com',
        'noreply@wixpress.com',
        '605a7baede844d278b89dc95ae0a9123@sentry.wixpress.com',
        'hello@typeform.com',
      ],
      ['ovh.com', 'wixpress.com', 'typeform.com'],
    );
    expect(kept).toEqual([]);
    expect(rejected.every((r) => r.reason === 'service_provider')).toBe(true);
  });

  it('ecarte un domaine sans rapport avec l entreprise', () => {
    const { kept, rejected } = garder(['contact@autre-societe.fr', 'acme.paris@gmail.com']);
    expect(kept).toEqual([]);
    expect(rejected.every((r) => r.reason === 'unrelated_domain')).toBe(true);
  });

  it('garde un autre domaine confirme par les mentions legales', () => {
    const { kept } = garder(
      ['rh@acme-groupe.com', 'acme.paris@gmail.com'],
      ['acme-groupe.com', 'gmail.com'],
    );
    expect(kept.map((a) => a.address)).toEqual(['rh@acme-groupe.com', 'acme.paris@gmail.com']);
  });

  it('ne confond pas un domaine qui se termine comme celui de l entreprise', () => {
    expect(garder(['contact@notacme.fr']).kept).toEqual([]);
  });
});
