import type { WebResult } from '../providers/web-search.js';
import { registrableDomain } from '../net/domain.js';
import { normalizeCompanyName, normalizeDomain } from './normalize.js';
import { thirdPartyKind } from './third-party.js';

/**
 * Le site officiel d'une entreprise parmi des resultats de recherche web
 * (F-305), avec un indice de confiance.
 *
 * L'indice ne pretend pas a la certitude : il dit si le domaine ressemble au
 * nom, si la page en parle, et si le moteur le place en tete. Sous le seuil,
 * l'entreprise passe en « domaine a confirmer » et c'est l'utilisateur qui
 * tranche ; la collecte n'y va pas avant.
 */

export const CONFIDENCE_THRESHOLD = 70;

/** Au-dessous, aucun resultat ne ressemble assez a l'entreprise pour etre propose. */
const SCORE_MINIMUM = 35;

/** Sites de reference qui parlent d'une entreprise sans etre la sienne. */
const PAS_UN_SITE_OFFICIEL = [
  'wikipedia.org',
  'wikimedia.org',
  'lefigaro.fr',
  'lemonde.fr',
  'lesechos.fr',
  'bfmtv.com',
  'ouest-france.fr',
  'francebleu.fr',
  'tripadvisor.fr',
  'tripadvisor.com',
  'yelp.fr',
  'trustpilot.com',
  'glassdoor.fr',
  'glassdoor.com',
  'gouv.fr',
  'data.gouv.fr',
  'doctolib.fr',
];

export interface OfficialSite {
  readonly domain: string;
  readonly confidence: number;
}

function compact(texte: string): string {
  return normalizeCompanyName(texte).replace(/[^a-z0-9]/g, '');
}

function etiquette(domaine: string): string {
  return compact(registrableDomain(domaine).split('.')[0] ?? '');
}

function exclu(domaine: string, nomCompact: string): boolean {
  if (thirdPartyKind(domaine) !== undefined) return true;
  // Un annuaire n'est exclu que s'il n'est pas l'entreprise elle-meme :
  // chercher « Doctolib » doit bien rendre doctolib.fr.
  return PAS_UN_SITE_OFFICIEL.some(
    (reference) =>
      (domaine === reference || domaine.endsWith(`.${reference}`)) &&
      etiquette(reference) !== nomCompact,
  );
}

export function scoreResult(resultat: WebResult, rang: number, nom: string): number {
  const domaine = normalizeDomain(resultat.url);
  if (domaine === undefined) return 0;
  const nomCompact = compact(nom);
  if (nomCompact === '' || exclu(domaine, nomCompact)) return 0;

  const hote = etiquette(domaine);
  let score = 0;
  if (hote === nomCompact) score += 60;
  else if (hote.length >= 4 && (hote.includes(nomCompact) || nomCompact.includes(hote)))
    score += 40;
  else {
    const mots = normalizeCompanyName(nom)
      .split(' ')
      .filter((mot) => mot.length >= 4);
    if (mots.some((mot) => hote.includes(mot))) score += 20;
  }

  if (compact(resultat.title).includes(nomCompact)) score += 20;
  score += [15, 10, 5][rang] ?? 0;
  try {
    if (new URL(resultat.url).pathname.replace(/\/$/, '') === '') score += 5;
  } catch {
    // URL illisible : pas de bonus.
  }
  return Math.min(score, 100);
}

export function chooseOfficialSite(
  resultats: readonly WebResult[],
  nom: string,
): OfficialSite | undefined {
  let meilleur: OfficialSite | undefined;
  resultats.forEach((resultat, rang) => {
    const score = scoreResult(resultat, rang, nom);
    const hote = normalizeDomain(resultat.url);
    if (hote === undefined || score < SCORE_MINIMUM) return;
    // guide.michelin.com sort avant michelin.com : quand le domaine
    // enregistrable porte le nom, c'est lui le site de l'entreprise. Sinon le
    // sous-domaine est garde, seul a la designer chez un hebergeur.
    const racine = registrableDomain(hote);
    const domaine = etiquette(racine) === compact(nom) ? racine : hote;
    if (meilleur === undefined || score > meilleur.confidence) {
      meilleur = { domain: domaine, confidence: score };
    }
  });
  return meilleur;
}
