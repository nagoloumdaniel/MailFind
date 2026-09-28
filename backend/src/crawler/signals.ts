import { careersPlatformOf } from '../companies/third-party.js';
import { registrableDomain } from '../net/domain.js';
import type { ParsedPage } from './document.js';
import { fold } from './pages.js';

/**
 * Ce qu'une page dit de l'entreprise en dehors de ses adresses : les canaux
 * de remplacement quand aucune adresse n'est publiee (F-408), le signe qu'elle
 * n'a pas pu etre lue (F-412), et le releve complementaire de F-409.
 */

export interface PageSignals {
  /** La page porte un formulaire de contact : ecrire par la reste possible. */
  readonly contactForm: boolean;
  /** Un lien vers une page carrieres, sur le site ou chez une plateforme. */
  readonly careersUrl?: URL;
  /** Page rendue par JavaScript : son contenu n'a pas ete lu (F-412). */
  readonly dynamicContent: boolean;
  /** F-409, priorite S : standard telephonique et page LinkedIn de l'entreprise. */
  readonly phone?: string;
  readonly linkedinUrl?: string;
  /** Page de mentions legales : les domaines qu'on y voit sont confirmes (F-410). */
  readonly legalNotice: boolean;
}

const MOTS_CARRIERES = [
  'recrutement',
  'carrieres',
  'carriere',
  'careers',
  'career',
  'jobs',
  'emplois',
  'emploi',
  'nous-rejoindre',
  'rejoignez-nous',
  'join-us',
  'offres-d-emploi',
];

const MOTS_LEGAUX = ['mentions-legales', 'legal', 'legal-notice', 'mentions', 'impressum'];

function porte(texte: string, mots: readonly string[]): boolean {
  const entoure = `-${texte}-`;
  return mots.some((mot) => entoure.includes(`-${mot}-`));
}

/**
 * Un formulaire de contact a une zone de message. Un champ d'adresse seul est
 * une inscription a une lettre d'information, et un champ unique une
 * recherche : ni l'un ni l'autre ne permettent d'ecrire a l'entreprise.
 */
function aUnFormulaireDeContact(page: ParsedPage): boolean {
  let trouve = false;
  page.$('form').each((_, formulaire) => {
    if (page.$(formulaire).find('textarea').length > 0) trouve = true;
  });
  return trouve;
}

/**
 * Une page dont le texte tient en quelques mots mais qui charge des scripts
 * et monte une application dans un conteneur vide : ce qu'un visiteur voit
 * est construit par JavaScript, que la collecte n'execute pas (F-412).
 */
function estDynamique(page: ParsedPage): boolean {
  if (page.text.length >= 200) return false;
  const scripts = page.$('script[src], script:not([type="application/ld+json"])').length;
  if (scripts === 0) return false;
  const conteneurVide = page
    .$('#root, #app, #__next, #__nuxt, [data-reactroot], app-root')
    .filter((_, element) => page.$(element).text().trim() === '').length;
  const avertissement = /javascript/i.test(page.$('noscript').text());
  return conteneurVide > 0 || avertissement;
}

function telephone(page: ParsedPage): string | undefined {
  const lien = page.$('a[href^="tel:" i]').first().attr('href');
  if (lien === undefined) return undefined;
  const numero = decodeURIComponent(lien.slice(4)).replace(/[^\d+]/g, '');
  return numero.length >= 8 && numero.length <= 16 ? numero : undefined;
}

export function pageSignals(page: ParsedPage): PageSignals {
  const siteEntreprise = registrableDomain(page.url.hostname);

  let careersUrl: URL | undefined;
  let linkedinUrl: string | undefined;
  for (const lien of page.links) {
    const hote = lien.url.hostname;
    if (linkedinUrl === undefined && /(^|\.)linkedin\.com$/.test(hote)) {
      if (/^\/company\/[^/]+/.test(lien.url.pathname)) {
        linkedinUrl = `https://www.linkedin.com${/^\/company\/[^/]+/.exec(lien.url.pathname)?.[0] ?? ''}`;
      }
    }
    if (careersUrl !== undefined) continue;
    if (lien.url.protocol !== 'http:' && lien.url.protocol !== 'https:') continue;
    const surLeSite = registrableDomain(hote) === siteEntreprise;
    const chemin = fold(lien.url.pathname);
    if (careersPlatformOf(hote) !== undefined) careersUrl = lien.url;
    else if (
      surLeSite &&
      (porte(chemin, MOTS_CARRIERES) || porte(fold(lien.text), MOTS_CARRIERES))
    ) {
      careersUrl = lien.url;
    }
  }

  const chemin = fold(page.url.pathname);
  const titre = fold(page.$('h1').first().text());
  const numero = telephone(page);

  return {
    contactForm: aUnFormulaireDeContact(page),
    ...(careersUrl === undefined ? {} : { careersUrl }),
    dynamicContent: estDynamique(page),
    ...(numero === undefined ? {} : { phone: numero }),
    ...(linkedinUrl === undefined ? {} : { linkedinUrl }),
    legalNotice: porte(chemin, MOTS_LEGAUX) || porte(titre, MOTS_LEGAUX),
  };
}
