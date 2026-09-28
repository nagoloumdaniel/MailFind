import { isTag } from 'domhandler';
import { visibleText, type ParsedPage } from './document.js';

/**
 * Releve des adresses publiees sur une page (F-406), sans jamais decoder une
 * adresse qu'un site a volontairement masquee (F-407).
 *
 * La frontiere entre les deux est celle du cahier des charges : ce qu'un
 * visiteur lit tel quel, meme ecrit « contact [at] acme [point] fr », est
 * publie ; ce qu'il faut executer, dechiffrer ou lire dans une image pour
 * l'obtenir ne l'est pas. Une page qui masque ses adresses est notee comme
 * telle, et le formulaire de contact est propose a la place.
 */

export type ExtractionMethod =
  'mailto' | 'microdata' | 'json_ld' | 'attribute' | 'text' | 'written_form';

export interface FoundAddress {
  /** Partie locale telle qu'ecrite, domaine en minuscules. */
  readonly address: string;
  readonly normalized: string;
  readonly method: ExtractionMethod;
  /** 200 caracteres au plus, texte brut : a echapper a l'affichage (S-06). */
  readonly excerpt: string;
}

export interface Extraction {
  readonly found: readonly FoundAddress[];
  /** Une adresse masquee a ete vue et laissee telle quelle (F-407). */
  readonly masked: boolean;
}

/**
 * L'ordre des methodes est aussi celui de leur fiabilite. Une adresse vue par
 * plusieurs sur la meme page n'est gardee qu'une fois, avec la plus sure.
 */
const PRIORITE: readonly ExtractionMethod[] = [
  'mailto',
  'microdata',
  'json_ld',
  'attribute',
  'text',
  'written_form',
];

const EXTRAIT_MAX = 200;

/**
 * Un sous-ensemble strict de la RFC 5321 : ce qu'une entreprise publie
 * vraiment. Les formes exotiques qu'autorise la norme (guillemets,
 * commentaires) n'apparaissent pas sur un site vitrine, et les accepter ne
 * ferait qu'ouvrir la porte aux faux positifs.
 */
const ADRESSE =
  /(?<![\w.%+-])([a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9_%+-])?)@((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?![a-z0-9-])/gi;

/** « contact [at] acme [point] fr », « contact(at)acme.fr », « {arobase} », « [dot] ». */
const FORME_ECRITE =
  /(?<![\w.%+-])([a-z0-9][a-z0-9._%+-]{0,63})\s*[[({]\s*(?:at|arobase|@)\s*[\])}]\s*([a-z0-9][a-z0-9-]{0,62}(?:\s*(?:[[({]\s*(?:dot|point)\s*[\])}]|\.)\s*[a-z0-9][a-z0-9-]{0,62})+)/gi;

const ATTRIBUTS = /^(data-[\w-]+|content|value|title)$/i;

function valide(locale: string, domaine: string): boolean {
  if (locale.length > 64 || locale.length + domaine.length + 1 > 254) return false;
  if (locale.includes('..') || locale.startsWith('.') || locale.endsWith('.')) return false;
  const extension = domaine.split('.').at(-1) ?? '';
  return /^[a-z]{2,24}$/i.test(extension) && domaine.includes('.');
}

function construire(locale: string, domaine: string): { address: string; normalized: string } {
  const adresse = `${locale}@${domaine.toLowerCase()}`;
  return { address: adresse, normalized: adresse.toLowerCase() };
}

/** Un extrait de contexte centre sur l'adresse, sans depasser 200 caracteres. */
export function excerptAround(texte: string, cible: string): string {
  const propre = texte.replace(/\s+/g, ' ').trim();
  const position = propre.toLowerCase().indexOf(cible.toLowerCase());
  if (propre.length <= EXTRAIT_MAX) return propre;
  if (position === -1) return `${propre.slice(0, EXTRAIT_MAX - 3)}...`;

  const marge = Math.floor((EXTRAIT_MAX - 6 - cible.length) / 2);
  const debut = Math.max(0, position - marge);
  const fin = Math.min(propre.length, position + cible.length + marge);
  const extrait = `${debut > 0 ? '...' : ''}${propre.slice(debut, fin)}${fin < propre.length ? '...' : ''}`;
  return extrait.slice(0, EXTRAIT_MAX);
}

function adressesDans(texte: string): { locale: string; domaine: string }[] {
  const trouvees: { locale: string; domaine: string }[] = [];
  for (const correspondance of texte.matchAll(ADRESSE)) {
    const [, locale, domaine] = correspondance;
    if (locale !== undefined && domaine !== undefined && valide(locale, domaine)) {
      trouvees.push({ locale, domaine });
    }
  }
  return trouvees;
}

/** Les chemins de JSON-LD qui portent une adresse : cle « email » ou valeur mailto. */
function adressesJsonLd(valeur: unknown, cle: string, sortie: string[]): void {
  if (typeof valeur === 'string') {
    if (cle.toLowerCase() === 'email' || valeur.toLowerCase().startsWith('mailto:')) {
      sortie.push(valeur.replace(/^mailto:/i, ''));
    }
    return;
  }
  if (Array.isArray(valeur)) {
    for (const element of valeur) adressesJsonLd(element, cle, sortie);
    return;
  }
  if (typeof valeur === 'object' && valeur !== null) {
    for (const [sousCle, sousValeur] of Object.entries(valeur)) {
      adressesJsonLd(sousValeur, sousCle, sortie);
    }
  }
}

/**
 * Les marques d'une adresse masquee a dessein. On les reconnait pour les
 * signaler, on ne cherche jamais a les defaire.
 */
function estMasquee(page: ParsedPage): boolean {
  const { $ } = page;
  if ($('[data-cfemail], .__cf_email__, a[href*="/cdn-cgi/l/email-protection"]').length > 0) {
    return true;
  }
  if (/\[email\s+protected\]/i.test(page.text)) return true;

  let assemblee = false;
  $('script:not([type="application/ld+json"])').each((_, element) => {
    const code = $(element).text();
    if (code.length > 5000) return;
    // Une adresse decoupee pour qu'un robot ne la lise pas : 'mai' + 'lto:',
    // '@' concatene, ou fabriquee a partir de codes de caracteres.
    if (
      /['"](?:m|ma|mai|mail|mailt|mailto:?)['"]\s*\+|\+\s*['"]@['"]|['"]@['"]\s*\+/i.test(code) ||
      (/fromCharCode|atob\(|unescape\(/.test(code) && /mail|@/i.test(code))
    ) {
      assemblee = true;
    }
  });
  return assemblee;
}

export function extractAddresses(page: ParsedPage): Extraction {
  const { $ } = page;
  const brutes: (FoundAddress & { rang: number })[] = [];
  const noter = (locale: string, domaine: string, method: ExtractionMethod, contexte: string) => {
    const { address, normalized } = construire(locale, domaine);
    brutes.push({
      address,
      normalized,
      method,
      excerpt: excerptAround(contexte, address),
      rang: PRIORITE.indexOf(method),
    });
  };

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href') ?? '';
    if (!/^mailto:/i.test(href)) return;
    let destinataires: string;
    try {
      destinataires = decodeURIComponent(href.slice('mailto:'.length).split('?')[0] ?? '');
    } catch {
      return;
    }
    const contexte = visibleText($, $(element).parent());
    for (const destinataire of destinataires.split(/[,;]/)) {
      for (const { locale, domaine } of adressesDans(destinataire.trim())) {
        noter(locale, domaine, 'mailto', contexte);
      }
    }
  });

  $('[itemprop="email"]').each((_, element) => {
    const source = $(element).attr('content') ?? $(element).attr('href') ?? $(element).text();
    for (const { locale, domaine } of adressesDans(source.replace(/^mailto:/i, ''))) {
      noter(locale, domaine, 'microdata', visibleText($, $(element).parent()));
    }
  });

  $('script[type="application/ld+json"]').each((_, element) => {
    let donnees: unknown;
    try {
      donnees = JSON.parse($(element).text());
    } catch {
      return;
    }
    const valeurs: string[] = [];
    adressesJsonLd(donnees, '', valeurs);
    for (const valeur of valeurs) {
      for (const { locale, domaine } of adressesDans(valeur)) {
        noter(locale, domaine, 'json_ld', 'Donnees structurees de la page (JSON-LD)');
      }
    }
  });

  $('*').each((_, element) => {
    if (!isTag(element)) return;
    for (const [nom, valeur] of Object.entries(element.attribs)) {
      if (!ATTRIBUTS.test(nom) || nom.toLowerCase() === 'data-cfemail') continue;
      for (const { locale, domaine } of adressesDans(valeur)) {
        noter(locale, domaine, 'attribute', visibleText($, $(element)) || `attribut ${nom}`);
      }
    }
  });

  for (const { locale, domaine } of adressesDans(page.text)) {
    noter(locale, domaine, 'text', page.text);
  }

  for (const correspondance of page.text.matchAll(FORME_ECRITE)) {
    const [ecrite, locale, reste] = correspondance;
    if (locale === undefined || reste === undefined || ecrite === undefined) continue;
    const domaine = reste
      .split(/\s*(?:[[({]\s*(?:dot|point)\s*[\])}]|\.)\s*/i)
      .filter((morceau) => morceau !== '')
      .join('.');
    if (valide(locale, domaine)) {
      const { address, normalized } = construire(locale, domaine);
      brutes.push({
        address,
        normalized,
        method: 'written_form',
        excerpt: excerptAround(page.text, ecrite),
        rang: PRIORITE.indexOf('written_form'),
      });
    }
  }

  // Une adresse par page, avec la methode la plus sure ; ordre stable :
  // methode d'abord, puis ordre d'apparition.
  const retenues = new Map<string, FoundAddress & { rang: number }>();
  for (const brute of brutes) {
    const connue = retenues.get(brute.normalized);
    if (connue === undefined || brute.rang < connue.rang) retenues.set(brute.normalized, brute);
  }
  const found = [...retenues.values()]
    .map((trouvee, ordre) => ({ trouvee, ordre }))
    .sort((a, b) => a.trouvee.rang - b.trouvee.rang || a.ordre - b.ordre)
    .map(({ trouvee }) => ({
      address: trouvee.address,
      normalized: trouvee.normalized,
      method: trouvee.method,
      excerpt: trouvee.excerpt,
    }));

  return { found, masked: estMasquee(page) };
}
