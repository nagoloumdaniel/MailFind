import { describe, expect, it } from 'vitest';
import { careersPlatformOf, thirdPartyKind } from './third-party.js';

describe('careersPlatformOf (F-306)', () => {
  it('reconnait les cinq plateformes du cahier des charges', () => {
    expect(careersPlatformOf('www.welcometothejungle.com')).toBe('Welcome to the Jungle');
    expect(careersPlatformOf('jobs.lever.co')).toBe('Lever');
    expect(careersPlatformOf('boards.greenhouse.io')).toBe('Greenhouse');
    expect(careersPlatformOf('job-boards.eu.greenhouse.io')).toBe('Greenhouse');
    expect(careersPlatformOf('acme.teamtailor.com')).toBe('Teamtailor');
    expect(careersPlatformOf('apply.workable.com')).toBe('Workable');
  });

  it('ne confond pas un domaine qui ressemble a une plateforme', () => {
    expect(careersPlatformOf('lever.com')).toBeUndefined();
    expect(careersPlatformOf('greenhouse-paysagiste.fr')).toBeUndefined();
    expect(careersPlatformOf('notlever.co')).toBeUndefined();
  });
});

describe('thirdPartyKind', () => {
  it('range chaque hote tiers dans sa famille', () => {
    expect(thirdPartyKind('fr.linkedin.com')).toBe('social');
    expect(thirdPartyKind('www.facebook.com')).toBe('social');
    expect(thirdPartyKind('www.societe.com')).toBe('directory');
    expect(thirdPartyKind('acme.teamtailor.com')).toBe('careers');
  });

  it('laisse un site d entreprise tel quel', () => {
    expect(thirdPartyKind('doctolib.fr')).toBeUndefined();
    expect(thirdPartyKind('careers.doctolib.fr')).toBeUndefined();
  });
});
