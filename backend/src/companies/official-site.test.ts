import { describe, expect, it } from 'vitest';
import { chooseOfficialSite, CONFIDENCE_THRESHOLD } from './official-site.js';

const resultat = (url: string, title = '') => ({ url, title, description: '' });

describe('chooseOfficialSite (F-305)', () => {
  it('reconnait le site dont le domaine porte le nom, en tete des resultats', () => {
    const choix = chooseOfficialSite(
      [
        resultat('https://www.doctolib.fr/', 'Doctolib : prenez rendez-vous'),
        resultat('https://fr.wikipedia.org/wiki/Doctolib', 'Doctolib — Wikipedia'),
      ],
      'Doctolib SAS',
    );
    expect(choix?.domain).toBe('doctolib.fr');
    expect(choix?.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

  it('ne prend jamais un reseau social, une plateforme ou une encyclopedie', () => {
    const choix = chooseOfficialSite(
      [
        resultat('https://www.linkedin.com/company/acme-industrie', 'Acme Industrie | LinkedIn'),
        resultat('https://www.welcometothejungle.com/fr/companies/acme', 'Acme Industrie'),
        resultat('https://fr.wikipedia.org/wiki/Acme', 'Acme Industrie'),
      ],
      'Acme Industrie',
    );
    expect(choix).toBeUndefined();
  });

  it('propose avec une confiance basse un domaine qui ne ressemble qu en partie au nom', () => {
    const choix = chooseOfficialSite(
      [resultat('https://www.boulangerie-lyon.fr/', 'Pains et viennoiseries')],
      'Boulangerie Martin',
    );
    expect(choix?.domain).toBe('boulangerie-lyon.fr');
    expect(choix?.confidence).toBeLessThan(CONFIDENCE_THRESHOLD);
  });

  it('ne propose rien quand aucun resultat ne ressemble a l entreprise', () => {
    expect(
      chooseOfficialSite([resultat('https://www.meteo.fr/', 'Meteo')], 'Boulangerie Martin'),
    ).toBeUndefined();
  });

  it('prefere le resultat le plus ressemblant a celui qui arrive premier', () => {
    const choix = chooseOfficialSite(
      [
        resultat('https://www.annuaire-artisans.fr/martin', 'Artisans de Lyon'),
        resultat('https://www.boulangeriemartin.fr/', 'Boulangerie Martin, Lyon'),
      ],
      'Boulangerie Martin',
    );
    expect(choix?.domain).toBe('boulangeriemartin.fr');
  });
});
