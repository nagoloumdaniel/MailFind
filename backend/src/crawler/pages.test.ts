import { describe, expect, it } from 'vitest';
import { parsePage } from './document.js';
import { fold, keywordRank, pageKey, selectInternalLinks, selectPages } from './pages.js';

const SITE = new URL('https://www.acme.fr/');

const ACCUEIL = `<!doctype html><html><body>
  <nav>
    <a href="/produits">Nos produits</a>
    <a href="/presse">Espace presse</a>
    <a href="/nous-rejoindre">Nous rejoindre</a>
    <a href="/mentions-legales">Mentions légales</a>
    <a href="/qui-sommes-nous">À propos</a>
    <a href="https://acme.fr/contact/">Contact</a>
    <a href="/contact#formulaire">Écrivez-nous</a>
    <a href="/plaquette.pdf">Plaquette</a>
    <a href="https://www.linkedin.com/company/acme">LinkedIn</a>
    <a href="mailto:contact@acme.fr">contact@acme.fr</a>
    <a href="/pressure">Nettoyage haute pression</a>
    <a href="https://blog.acme.fr/equipe">L'équipe</a>
  </nav>
</body></html>`;

const liens = parsePage(ACCUEIL, SITE).links;
const visite = new Set([pageKey(SITE)]);
const chemins = (urls: URL[]) => urls.map((url) => `${url.hostname}${url.pathname}`);

describe('fold', () => {
  it('replie accents, casse et ponctuation', () => {
    expect(fold('Mentions légales')).toBe('mentions-legales');
    expect(fold('/A-propos/')).toBe('a-propos');
  });
});

describe('keywordRank', () => {
  it('reconnait un mot cle dans le chemin ou dans le texte du lien', () => {
    expect(keywordRank({ url: new URL('https://acme.fr/nous-contacter'), text: '' })).toBe(2);
    expect(keywordRank({ url: new URL('https://acme.fr/qui-sommes-nous'), text: 'À propos' })).toBe(
      3,
    );
  });

  it('ne se laisse pas prendre par un mot qui en contient un autre', () => {
    expect(keywordRank({ url: new URL('https://acme.fr/pressure'), text: 'Haute pression' })).toBe(
      undefined,
    );
    expect(keywordRank({ url: new URL('https://acme.fr/jobsearch-tips'), text: '' })).toBe(
      undefined,
    );
  });
});

describe('selectPages (F-401, F-402)', () => {
  it('va d abord aux pages contact, puis suit l ordre du cahier des charges', () => {
    const pages = selectPages({ site: SITE, links: liens, depth: 'standard', visited: visite });
    expect(chemins(pages)).toEqual([
      'acme.fr/contact/',
      'www.acme.fr/qui-sommes-nous',
      'blog.acme.fr/equipe',
      'www.acme.fr/mentions-legales',
      'www.acme.fr/nous-rejoindre',
      'www.acme.fr/presse',
    ]);
  });

  it('ne garde qu une fois la meme page, ancre ou barre finale comprises', () => {
    const pages = selectPages({ site: SITE, links: liens, depth: 'standard', visited: visite });
    expect(pages.filter((url) => url.pathname.startsWith('/contact'))).toHaveLength(1);
  });

  it('ignore les fichiers, les autres sites et les liens mailto', () => {
    const pages = chemins(
      selectPages({ site: SITE, links: liens, depth: 'deep', visited: visite }),
    );
    expect(pages.some((page) => page.endsWith('.pdf'))).toBe(false);
    expect(pages.some((page) => page.includes('linkedin'))).toBe(false);
  });

  it('se limite a la page contact en profondeur rapide, trois pages au plus', () => {
    const pages = selectPages({ site: SITE, links: liens, depth: 'quick', visited: visite });
    expect(chemins(pages)).toEqual(['acme.fr/contact/']);
  });

  it('ajoute la page carrieres de l import juste apres les pages contact', () => {
    const pages = selectPages({
      site: SITE,
      links: liens,
      depth: 'quick',
      visited: visite,
      careersUrl: new URL('https://acme.teamtailor.com/jobs'),
    });
    expect(chemins(pages)).toEqual(['acme.fr/contact/', 'acme.teamtailor.com/jobs']);
  });

  it('respecte le plafond de dix pages, accueil compris', () => {
    const beaucoup = Array.from({ length: 30 }, (_, i) => ({
      url: new URL(`https://acme.fr/contact-${String(i)}`),
      text: 'Contact',
    }));
    const pages = selectPages({ site: SITE, links: beaucoup, depth: 'standard', visited: visite });
    expect(pages).toHaveLength(9);
  });

  it('ne rend rien quand le plafond est deja atteint', () => {
    const pleines = new Set(Array.from({ length: 3 }, (_, i) => `acme.fr/p${String(i)}`));
    expect(selectPages({ site: SITE, links: liens, depth: 'quick', visited: pleines })).toEqual([]);
  });
});

describe('selectInternalLinks (profondeur approfondie)', () => {
  it('prend les liens internes non visites, mots cles d abord, sans depasser la limite', () => {
    const suivants = selectInternalLinks({
      site: SITE,
      links: liens,
      visited: new Set([pageKey(SITE), pageKey(new URL('https://acme.fr/contact'))]),
      limit: 3,
    });
    expect(chemins(suivants)).toEqual([
      'www.acme.fr/qui-sommes-nous',
      'blog.acme.fr/equipe',
      'www.acme.fr/mentions-legales',
    ]);
  });
});
