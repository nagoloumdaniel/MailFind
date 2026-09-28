/**
 * Type d'une adresse d'apres sa partie locale (section 6.8), et prefixes de
 * role des adresses candidates (annexe D).
 *
 * Le prefixe d'abord, puis le contexte de la page : une adresse generique
 * vue sur la page carrieres compte pour le recrutement (`typeInContext`).
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

/** Pages dont le chemin dit qu'elles parlent de recrutement. */
const PAGES_CARRIERES = [
  'recrutement',
  'carrieres',
  'carriere',
  'careers',
  'career',
  'jobs',
  'emploi',
  'emplois',
  'rejoindre',
  'nous-rejoindre',
  'rejoignez-nous',
  'join-us',
];

function surUnePageCarrieres(pageUrl: string): boolean {
  let chemin: string;
  try {
    chemin = decodeURIComponent(new URL(pageUrl).pathname);
  } catch {
    return false;
  }
  const replie = `-${chemin
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}-`;
  return PAGES_CARRIERES.some((mot) => replie.includes(`-${mot}-`));
}

/**
 * Section 6.8 : le type par le prefixe, affine par la page ou l'adresse a ete
 * vue. Une adresse generique ou sans type, publiee sur la page carrieres, est
 * celle ou l'entreprise attend les candidatures.
 */
export function typeInContext(localPart: string, pageUrl?: string): EmailType {
  const parPrefixe = classifyLocalPart(localPart);
  if (pageUrl === undefined) return parPrefixe;
  if ((parPrefixe === 'generic' || parPrefixe === 'unknown') && surUnePageCarrieres(pageUrl)) {
    return 'recruitment';
  }
  return parPrefixe;
}
