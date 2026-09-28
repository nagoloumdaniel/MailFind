import { registrableDomain } from '../net/domain.js';
import type { PageLink } from './document.js';

/**
 * Les pages qu'on visite apres l'accueil, et dans quel ordre (F-401, F-402).
 *
 * La collecte ne parcourt jamais un site entier : elle va la ou une entreprise
 * publie ses adresses, dans l'ordre ou on a le plus de chances de les trouver,
 * et s'arrete au plafond de la profondeur choisie.
 */

export type CrawlDepth = 'quick' | 'standard' | 'deep';

/** F-402 : accueil compris. */
export const MAX_PAGES: Record<CrawlDepth, number> = { quick: 3, standard: 10, deep: 25 };

/** F-401, dans l'ordre. Le rang d'un lien est celui du premier mot qu'il porte. */
const MOTS_CLES = [
  'contact',
  'contactez-nous',
  'nous-contacter',
  'a-propos',
  'about',
  'equipe',
  'mentions-legales',
  'legal',
  'recrutement',
  'carrieres',
  'careers',
  'jobs',
  'rejoindre',
  'presse',
  'press',
];

/** La profondeur rapide ne va que vers la page contact. */
const MOTS_RAPIDES = new Set(['contact', 'contactez-nous', 'nous-contacter']);

/** Des fichiers, pas des pages : rien a y lire pour le moteur. */
const FICHIERS =
  /\.(pdf|jpe?g|png|gif|svg|webp|ico|zip|rar|7z|docx?|xlsx?|pptx?|mp[34]|avi|mov|webm|css|js|xml|json|txt)$/i;

/** « Mentions légales » devient « mentions-legales » : texte et chemin se comparent. */
export function fold(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Vrai quand le mot cle apparait en mots entiers : « /nous-contacter » et
 * « Mentions légales » correspondent, « /pressure » ne correspond pas a
 * « press ». Les chemins et les textes sont d'abord replies par `fold`.
 */
function porte(texte: string, mot: string): boolean {
  return `-${texte}-`.includes(`-${mot}-`);
}

/** Le rang F-401 d'un lien, ou `undefined` s'il ne porte aucun mot cle. */
export function keywordRank(link: PageLink): number | undefined {
  let chemin: string;
  try {
    chemin = fold(decodeURIComponent(link.url.pathname));
  } catch {
    chemin = fold(link.url.pathname);
  }
  const texte = fold(link.text);
  const rang = MOTS_CLES.findIndex((mot) => porte(chemin, mot) || porte(texte, mot));
  return rang === -1 ? undefined : rang;
}

/** Deux ecritures de la meme page comptent pour une : sans ancre ni barre finale. */
export function pageKey(url: URL): string {
  const chemin = url.pathname.replace(/\/+$/, '') || '/';
  return `${url.hostname.replace(/^www\./, '')}${chemin}${url.search}`;
}

function surLeSite(url: URL, site: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (FICHIERS.test(url.pathname)) return false;
  return registrableDomain(url.hostname) === registrableDomain(site.hostname);
}

/**
 * Les pages a visiter apres l'accueil, par ordre de priorite, sans depasser le
 * plafond. La page carrieres de l'import vient apres les pages contact : elle
 * est ajoutee meme si l'accueil n'y mene pas (F-401).
 */
export function selectPages(options: {
  readonly site: URL;
  readonly links: readonly PageLink[];
  readonly depth: CrawlDepth;
  readonly visited: ReadonlySet<string>;
  readonly careersUrl?: URL;
}): URL[] {
  const { site, depth, visited } = options;
  const places = MAX_PAGES[depth] - visited.size;
  if (places <= 0) return [];

  const vus = new Set(visited);
  const classes: { url: URL; rang: number; ordre: number }[] = [];
  options.links.forEach((lien, ordre) => {
    if (!surLeSite(lien.url, site)) return;
    const cle = pageKey(lien.url);
    if (vus.has(cle)) return;
    const rang = keywordRank(lien);
    if (rang === undefined) return;
    const mot = MOTS_CLES[rang] ?? '';
    if (depth === 'quick' && !MOTS_RAPIDES.has(mot)) return;
    vus.add(cle);
    classes.push({ url: lien.url, rang, ordre });
  });

  classes.sort((a, b) => a.rang - b.rang || a.ordre - b.ordre);
  const choisies = classes.map((entree) => entree.url);

  const carrieres = options.careersUrl;
  if (carrieres !== undefined && !vus.has(pageKey(carrieres))) {
    // Juste apres les pages contact, qui restent les plus riches en adresses.
    const apresContact = choisies.findIndex((url) => {
      const rang = keywordRank({ url, text: '' });
      return rang === undefined || !MOTS_RAPIDES.has(MOTS_CLES[rang] ?? '');
    });
    choisies.splice(apresContact === -1 ? choisies.length : apresContact, 0, carrieres);
  }

  return choisies.slice(0, places);
}

/**
 * Profondeur approfondie : les liens internes des pages deja visitees, une
 * fois les pages de F-401 epuisees. Les liens a mot cle passent d'abord.
 */
export function selectInternalLinks(options: {
  readonly site: URL;
  readonly links: readonly PageLink[];
  readonly visited: ReadonlySet<string>;
  readonly limit: number;
}): URL[] {
  if (options.limit <= 0) return [];
  const vus = new Set(options.visited);
  const candidats: { url: URL; rang: number; ordre: number }[] = [];
  options.links.forEach((lien, ordre) => {
    if (!surLeSite(lien.url, options.site)) return;
    const cle = pageKey(lien.url);
    if (vus.has(cle)) return;
    vus.add(cle);
    candidats.push({ url: lien.url, rang: keywordRank(lien) ?? MOTS_CLES.length, ordre });
  });
  candidats.sort((a, b) => a.rang - b.rang || a.ordre - b.ordre);
  return candidats.slice(0, options.limit).map((entree) => entree.url);
}
