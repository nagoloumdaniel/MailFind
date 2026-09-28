import * as cheerio from 'cheerio';
import { isTag, isText, type AnyNode } from 'domhandler';

/**
 * Une page HTML lue une seule fois, puis interrogee par chaque etape du
 * moteur : selection des liens, extraction des adresses, reperage des
 * formulaires.
 *
 * Le contenu est hostile par principe (S-06) : on y lit, on n'y execute rien,
 * et rien de ce qui en sort n'est rendu tel quel dans l'interface.
 */

export interface PageLink {
  readonly url: URL;
  /** Texte du lien, espaces resserres. */
  readonly text: string;
}

export interface ParsedPage {
  readonly url: URL;
  readonly $: cheerio.CheerioAPI;
  /** Texte visible, un espace entre chaque bloc, scripts et styles retires. */
  readonly text: string;
  readonly links: readonly PageLink[];
}

/** Ce qui n'est pas du texte lu par un visiteur. */
const INVISIBLE = 'script, style, noscript, template, svg, iframe, head';

function resserrer(texte: string): string {
  return texte.replace(/\s+/g, ' ').trim();
}

/**
 * Le texte d'un noeud, avec un espace entre chaque morceau. `.text()` de
 * Cheerio colle les blocs : « contact@acme.fr</p><p>Tel » deviendrait
 * « contact@acme.frTel », et l'adresse lue serait fausse.
 */
export function visibleText($: cheerio.CheerioAPI, racine: cheerio.Cheerio<AnyNode>): string {
  const morceaux: string[] = [];
  const parcourir = (noeuds: cheerio.Cheerio<AnyNode>) => {
    noeuds.contents().each((_, noeud) => {
      if (isText(noeud)) morceaux.push(noeud.data);
      else if (isTag(noeud) && !$(noeud).is(INVISIBLE)) parcourir($(noeud));
    });
  };
  parcourir(racine);
  return resserrer(morceaux.join(' '));
}

export function parsePage(html: string, url: URL): ParsedPage {
  const $ = cheerio.load(html);
  const base = $('base[href]').attr('href');
  let origine = url;
  if (base !== undefined) {
    try {
      origine = new URL(base, url);
    } catch {
      // Balise <base> invalide : on garde l'adresse de la page.
    }
  }

  const links: PageLink[] = [];
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href') ?? '';
    try {
      const cible = new URL(href, origine);
      cible.hash = '';
      links.push({ url: cible, text: resserrer($(element).text()) });
    } catch {
      // Lien illisible : ignore.
    }
  });

  const corps = $('body');
  return { url, $, text: visibleText($, corps.length > 0 ? corps : $.root()), links };
}
