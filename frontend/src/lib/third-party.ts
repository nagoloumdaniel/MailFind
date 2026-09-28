/**
 * Sites qui hebergent la page d'une entreprise sans etre son site (F-306).
 *
 * Copie de `backend/src/companies/third-party.ts`, qui fait autorite : l'apercu
 * doit ecarter exactement les lignes que le serveur ecartera.
 *
 * Une offre sur Welcome to the Jungle ou une page LinkedIn designe bien
 * l'entreprise, mais leur domaine n'est pas le sien. Le prendre pour tel
 * aurait deux effets : la collecte explorerait la plateforme au lieu du site,
 * et le dedoublonnage par domaine fondrait en une seule toutes les entreprises
 * dont le fichier ne donnait que ce lien.
 *
 */

export type ThirdPartyKind = 'careers' | 'social' | 'directory';

/** Plateformes de recrutement : la page devient la page carrieres de l'entreprise. */
const CAREERS: Record<string, string> = {
  'welcometothejungle.com': 'Welcome to the Jungle',
  'welcometothejungle.co': 'Welcome to the Jungle',
  'lever.co': 'Lever',
  'greenhouse.io': 'Greenhouse',
  'teamtailor.com': 'Teamtailor',
  'workable.com': 'Workable',
  'smartrecruiters.com': 'SmartRecruiters',
  'recruitee.com': 'Recruitee',
  'jobteaser.com': 'JobTeaser',
  'hellowork.com': 'HelloWork',
  'indeed.com': 'Indeed',
  'indeed.fr': 'Indeed',
  'taleez.com': 'Taleez',
  'flatchr.io': 'Flatchr',
  'breezy.hr': 'Breezy',
  'personio.de': 'Personio',
  'personio.com': 'Personio',
  'ashbyhq.com': 'Ashby',
  'join.com': 'JOIN',
};

/** Reseaux sociaux : ils ne disent rien du domaine de l'entreprise. */
const SOCIAL = new Set([
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'tiktok.com',
  'linktr.ee',
]);

/** Annuaires et fiches d'entreprise : une page parmi des millions d'autres. */
const DIRECTORY = new Set([
  'societe.com',
  'pappers.fr',
  'pagesjaunes.fr',
  'infogreffe.fr',
  'verif.com',
  'annuaire-entreprises.data.gouv.fr',
  'google.com',
  'goo.gl',
  'bit.ly',
]);

function suffixes(hostname: string): string[] {
  const parties = hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '')
    .split('.');
  return parties.map((_, index) => parties.slice(index).join('.'));
}

export function thirdPartyKind(hostname: string): ThirdPartyKind | undefined {
  for (const suffixe of suffixes(hostname)) {
    if (suffixe in CAREERS) return 'careers';
    if (SOCIAL.has(suffixe)) return 'social';
    if (DIRECTORY.has(suffixe)) return 'directory';
  }
  return undefined;
}

/** Le nom de la plateforme de recrutement qui heberge cette page, s'il y en a une. */
export function careersPlatformOf(hostname: string): string | undefined {
  for (const suffixe of suffixes(hostname)) {
    const nom = CAREERS[suffixe];
    if (nom !== undefined) return nom;
  }
  return undefined;
}
