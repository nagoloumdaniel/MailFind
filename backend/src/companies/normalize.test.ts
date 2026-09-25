import { describe, expect, it } from 'vitest';
import {
  normalizeCompanyName,
  normalizeDomain,
  normalizeSiren,
  normalizeTags,
  normalizeUrl,
} from './normalize.js';

describe('normalizeDomain', () => {
  it('accepte un domaine nu', () => {
    expect(normalizeDomain('doctolib.fr')).toBe('doctolib.fr');
  });

  it('ajoute le protocole absent et retire le chemin (F-301)', () => {
    expect(normalizeDomain('www.doctolib.fr/carrieres')).toBe('doctolib.fr');
  });

  it('retire www et met en minuscules', () => {
    expect(normalizeDomain('HTTP://WWW.Doctolib.FR')).toBe('doctolib.fr');
  });

  it('garde un sous-domaine qui n est pas www', () => {
    expect(normalizeDomain('https://careers.doctolib.fr')).toBe('careers.doctolib.fr');
  });

  it('retire le port et le fragment', () => {
    expect(normalizeDomain('https://exemple.fr:8443/page#ancre')).toBe('exemple.fr');
  });

  it('convertit un domaine internationalise en punycode (F-301)', () => {
    expect(normalizeDomain('café.fr')).toBe('xn--caf-dma.fr');
    expect(normalizeDomain('https://société.exemple.com/x')).toBe('xn--socit-esab.exemple.com');
  });

  it('retire le point final', () => {
    expect(normalizeDomain('doctolib.fr.')).toBe('doctolib.fr');
  });

  it('refuse une adresse IP', () => {
    // Une entreprise a un nom de domaine. Accepter une IP ouvrirait la porte
    // que la protection contre la falsification de requete doit tenir fermee.
    expect(normalizeDomain('192.168.1.10')).toBeUndefined();
    expect(normalizeDomain('http://127.0.0.1:3000')).toBeUndefined();
  });

  it('refuse ce qui n est pas un domaine', () => {
    expect(normalizeDomain('')).toBeUndefined();
    expect(normalizeDomain('   ')).toBeUndefined();
    expect(normalizeDomain('pas un domaine')).toBeUndefined();
    expect(normalizeDomain('localhost')).toBeUndefined();
    expect(normalizeDomain('mailto:contact@exemple.fr')).toBeUndefined();
    expect(normalizeDomain('javascript:alert(1)')).toBeUndefined();
  });

  it('refuse une etiquette vide', () => {
    expect(normalizeDomain('exemple..fr')).toBeUndefined();
  });

  it('refuse une adresse email deguisee en URL', () => {
    // Sans garde, « https:// » colle devant ferait lire « mailto:contact »
    // comme des identifiants et « exemple.fr » comme l'hote.
    expect(normalizeDomain('mailto:contact@exemple.fr')).toBeUndefined();
    expect(normalizeDomain('contact@exemple.fr')).toBeUndefined();
    expect(normalizeDomain('https://utilisateur:motdepasse@exemple.fr')).toBeUndefined();
  });

  it('refuse une extension absente ou numerique', () => {
    expect(normalizeDomain('exemple')).toBeUndefined();
    expect(normalizeDomain('exemple.123')).toBeUndefined();
  });
});

describe('normalizeUrl', () => {
  it('ajoute le protocole et garde le chemin', () => {
    expect(normalizeUrl('www.exemple.fr/carrieres')).toBe('https://www.exemple.fr/carrieres');
  });

  it('retire le fragment et la barre finale', () => {
    expect(normalizeUrl('https://exemple.fr/carrieres/#offres')).toBe(
      'https://exemple.fr/carrieres',
    );
  });

  it('rend la racine sans barre finale', () => {
    expect(normalizeUrl('https://exemple.fr/')).toBe('https://exemple.fr');
  });

  it('refuse ce qui ne porte pas de domaine valable', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeUndefined();
    expect(normalizeUrl('http://127.0.0.1/interne')).toBeUndefined();
    expect(normalizeUrl('')).toBeUndefined();
  });
});

describe('normalizeCompanyName', () => {
  it('retire accents et casse (F-302)', () => {
    expect(normalizeCompanyName('Café de la Gare')).toBe('cafe de la gare');
  });

  it('retire la forme juridique en fin de nom', () => {
    expect(normalizeCompanyName('Doctolib SAS')).toBe('doctolib');
    expect(normalizeCompanyName('ACME Inc.')).toBe('acme');
    expect(normalizeCompanyName('Müller GmbH')).toBe('muller');
    expect(normalizeCompanyName('Example Ltd')).toBe('example');
  });

  it('retire la forme juridique en tete de nom', () => {
    expect(normalizeCompanyName('SARL Dupont')).toBe('dupont');
  });

  it('ne retire pas une forme juridique au milieu du nom', () => {
    // « SA » est ici un mot du nom, pas une forme juridique.
    expect(normalizeCompanyName('Banque SA Martin')).toBe('banque sa martin');
  });

  it('rapproche deux ecritures de la meme entreprise', () => {
    expect(normalizeCompanyName('DOCTOLIB S.A.S.')).toBe(normalizeCompanyName('Doctolib'));
    expect(normalizeCompanyName('Dupont & Fils')).toBe(normalizeCompanyName('DUPONT ET FILS'));
  });

  it('ne rend rien quand le nom n etait qu une forme juridique', () => {
    expect(normalizeCompanyName('SARL')).toBe('sarl');
    expect(normalizeCompanyName('  ')).toBe('');
  });
});

describe('normalizeSiren', () => {
  it('accepte neuf chiffres, espaces compris', () => {
    expect(normalizeSiren('794 598 813')).toBe('794598813');
  });

  it('garde le SIREN d un SIRET', () => {
    expect(normalizeSiren('79459881300021')).toBe('794598813');
  });

  it('refuse ce qui n a pas la bonne longueur', () => {
    expect(normalizeSiren('12345')).toBeUndefined();
    expect(normalizeSiren('AB')).toBeUndefined();
    expect(normalizeSiren('')).toBeUndefined();
  });
});

describe('normalizeTags', () => {
  it('separe sur la virgule et le point-virgule', () => {
    expect(normalizeTags('alternance;sante')).toEqual(['alternance', 'sante']);
    expect(normalizeTags('paris, lyon')).toEqual(['paris', 'lyon']);
  });

  it('dedoublonne et met en minuscules', () => {
    expect(normalizeTags('Paris;paris; PARIS ')).toEqual(['paris']);
  });

  it('rend une liste vide quand il n y a rien', () => {
    expect(normalizeTags(' ; , ')).toEqual([]);
  });
});
