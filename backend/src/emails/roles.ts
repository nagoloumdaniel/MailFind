/**
 * Type d'une adresse d'apres sa partie locale (section 6.8), et prefixes de
 * role des adresses candidates (annexe D).
 *
 * Ici, le prefixe seul. Le contexte de la page (une adresse generique vue sur
 * la page carrieres compte pour le recrutement) affine le type en Phase 5 ;
 * le prefixe suffit deja a decider s'il manque un type recherche, ce que le
 * repli des fournisseurs (F-603) et les candidates (F-501) demandent.
 */

export type EmailType =
  'recruitment' | 'hr' | 'generic' | 'sales' | 'press' | 'support' | 'personal' | 'unknown';

/** Types que l'utilisateur peut rechercher (etape 4 du parcours). */
export type WantedType = 'recruitment' | 'hr' | 'generic' | 'sales' | 'press';

/** Section 6.8, prefixes reconnus. */
const RECONNUS: Record<Exclude<EmailType, 'personal' | 'unknown'>, readonly string[]> = {
  recruitment: [
    'recrutement',
    'rh.recrutement',
    'recruitment',
    'recrutements',
    'jobs',
    'job',
    'careers',
    'career',
    'carrieres',
    'carriere',
    'talent',
    'talents',
    'candidature',
    'candidatures',
    'emploi',
    'alternance',
    'stage',
    'stages',
  ],
  hr: ['rh', 'hr', 'drh', 'people', 'ressources.humaines', 'ressourceshumaines'],
  generic: ['contact', 'hello', 'bonjour', 'info', 'infos', 'accueil', 'office'],
  sales: ['commercial', 'sales', 'business', 'ventes', 'vente'],
  press: ['presse', 'press', 'media', 'medias', 'communication'],
  support: ['support', 'help', 'aide', 'sav', 'assistance'],
};

/** Annexe D : prefixes des adresses candidates, par ordre d'essai. */
export const ROLE_PREFIXES: Record<WantedType, readonly string[]> = {
  recruitment: [
    'recrutement',
    'jobs',
    'careers',
    'carrieres',
    'rh.recrutement',
    'talent',
    'candidature',
    'emploi',
    'alternance',
    'stage',
  ],
  hr: ['rh', 'hr', 'drh', 'people'],
  generic: ['contact', 'hello', 'bonjour', 'info'],
  sales: ['commercial', 'sales', 'business'],
  press: ['presse', 'press', 'communication'],
};

const TYPES_RECONNUS = Object.keys(RECONNUS) as (keyof typeof RECONNUS)[];

export function classifyLocalPart(localPart: string): EmailType {
  const locale = localPart.toLowerCase();
  const premier = locale.split(/[._+-]/)[0] ?? '';

  // L'adresse entiere d'abord (« rh.recrutement »), puis son premier mot
  // (« recrutement.lyon », « contact-presse »).
  for (const cible of [locale, premier]) {
    for (const type of TYPES_RECONNUS) {
      if (RECONNUS[type].includes(cible)) return type;
    }
  }

  // Deux mots alphabetiques, ou une initiale et un mot : « jean.dupont »,
  // « j.dupont », « jean-dupont ». C'est une personne, a traiter avec
  // prudence (section 11).
  if (/^[a-z]{1,30}[._-][a-z]{2,30}$/.test(locale)) return 'personal';
  return 'unknown';
}
