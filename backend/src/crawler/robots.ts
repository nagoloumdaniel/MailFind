/**
 * Lecture de robots.txt selon la RFC 9309 (F-403).
 *
 * Un site qui nous demande de ne pas visiter une page n'a pas a le justifier,
 * et ne doit pas avoir a le repeter. Les regles d'un groupe qui nous nomme
 * remplacent celles du groupe general ; a defaut, le groupe general
 * s'applique ; a defaut encore, tout est permis. Entre deux regles qui
 * correspondent, la plus longue l'emporte, et une autorisation l'emporte a
 * longueur egale.
 */

export interface RobotsRules {
  isAllowed(path: string): boolean;
  /** Delai demande entre deux requetes, en millisecondes, s'il y en a un. */
  readonly crawlDelayMs?: number;
}

/** La RFC autorise a ignorer ce qui depasse 500 Kio. */
const LIMITE_OCTETS = 500 * 1024;

/**
 * `Crawl-delay` n'est pas dans la RFC, mais il est repandu et sa demande est
 * raisonnable : on l'honore, jusqu'a dix secondes. Au-dela, la collecte d'une
 * entreprise durerait des minutes pour quelques pages.
 */
const DELAI_MAX_MS = 10_000;

interface Regle {
  readonly allow: boolean;
  readonly motif: RegExp;
  readonly longueur: number;
}

/** Le nom d'agent a comparer : « MailFindBot/0.1 (+url) » donne « mailfindbot ». */
export function productToken(userAgent: string): string {
  return (userAgent.split(/[/\s]/)[0] ?? '').toLowerCase();
}

/**
 * La forme encodee d'un chemin, pour que « /café » dans le fichier et
 * « /caf%C3%A9 » dans l'URL se reconnaissent.
 */
function encoder(chemin: string): string {
  let sortie = '';
  for (const caractere of chemin) {
    sortie += /[\x21-\x7e]/.test(caractere) ? caractere : encodeURIComponent(caractere);
  }
  return sortie.replace(/%[0-9a-f]{2}/gi, (sequence) => sequence.toUpperCase());
}

function versMotif(chemin: string): RegExp {
  const ancre = chemin.endsWith('$');
  const corps = ancre ? chemin.slice(0, -1) : chemin;
  const echappe = encoder(corps)
    .split('*')
    .map((morceau) => morceau.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${echappe}${ancre ? '$' : ''}`);
}

function construire(regles: readonly Regle[], crawlDelayMs?: number): RobotsRules {
  return {
    ...(crawlDelayMs === undefined ? {} : { crawlDelayMs }),
    isAllowed(path: string) {
      // Le fichier lui-meme reste toujours lisible.
      if (path === '/robots.txt') return true;
      const cible = encoder(path);
      let meilleure: Regle | undefined;
      for (const regle of regles) {
        if (!regle.motif.test(cible)) continue;
        if (
          meilleure === undefined ||
          regle.longueur > meilleure.longueur ||
          (regle.longueur === meilleure.longueur && regle.allow)
        ) {
          meilleure = regle;
        }
      }
      return meilleure?.allow ?? true;
    },
  };
}

export const ALLOW_ALL: RobotsRules = construire([]);

/** Ce qu'impose la RFC quand le fichier est injoignable (erreur 5xx ou reseau). */
export const DISALLOW_ALL: RobotsRules = construire([{ allow: false, motif: /^\//, longueur: 1 }]);

interface Groupe {
  readonly agents: string[];
  readonly regles: Regle[];
  delaiMs?: number;
}

export function parseRobots(texte: string, token: string): RobotsRules {
  const groupes: Groupe[] = [];
  let courant: Groupe | undefined;
  let dernierEtaitAgent = false;

  for (const brute of texte.slice(0, LIMITE_OCTETS).split(/\r\n|\r|\n/)) {
    const ligne = brute.replace(/#.*$/, '').trim();
    const separation = ligne.indexOf(':');
    if (separation === -1) continue;

    const cle = ligne.slice(0, separation).trim().toLowerCase();
    const valeur = ligne.slice(separation + 1).trim();

    if (cle === 'user-agent') {
      // Plusieurs lignes d'agent a la suite ouvrent un seul et meme groupe.
      if (courant === undefined || !dernierEtaitAgent) {
        courant = { agents: [], regles: [] };
        groupes.push(courant);
      }
      courant.agents.push(valeur.toLowerCase());
      dernierEtaitAgent = true;
      continue;
    }

    dernierEtaitAgent = false;
    if (courant === undefined) continue;

    if ((cle === 'allow' || cle === 'disallow') && valeur !== '') {
      courant.regles.push({
        allow: cle === 'allow',
        motif: versMotif(valeur),
        longueur: encoder(valeur).length,
      });
    } else if (cle === 'crawl-delay') {
      const secondes = Number(valeur);
      if (Number.isFinite(secondes) && secondes >= 0) {
        courant.delaiMs = Math.min(secondes * 1000, DELAI_MAX_MS);
      }
    }
  }

  const nomment = groupes.filter((groupe) => groupe.agents.includes(token));
  const retenus =
    nomment.length > 0 ? nomment : groupes.filter((groupe) => groupe.agents.includes('*'));
  if (retenus.length === 0) return ALLOW_ALL;

  const delai = retenus.find((groupe) => groupe.delaiMs !== undefined)?.delaiMs;
  return construire(
    retenus.flatMap((groupe) => groupe.regles),
    delai,
  );
}
