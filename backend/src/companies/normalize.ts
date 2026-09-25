import { domainToASCII } from 'node:url';

/**
 * Normalisation des URL et des noms (F-301, F-302).
 *
 * Tout ce qui sert a comparer deux entreprises passe par ici. Deux ecritures
 * de la meme societe doivent tomber sur la meme valeur, sinon le
 * dedoublonnage ne peut rien faire.
 */

/**
 * Formes juridiques ecartees pour la comparaison, gardees pour l'affichage.
 * Retirees seulement en tete ou en fin de nom : « SA » au milieu d'un nom est
 * un mot, pas une forme juridique.
 */
const LEGAL_FORMS = [
  'sas',
  'sasu',
  'sarl',
  'eurl',
  'sa',
  'sci',
  'scop',
  'snc',
  'sca',
  'selarl',
  'gie',
  'asso',
  'association',
  'inc',
  'llc',
  'ltd',
  'limited',
  'plc',
  'corp',
  'corporation',
  'gmbh',
  'ag',
  'bv',
  'nv',
  'spa',
  'srl',
  'oy',
  'ab',
  'as',
];

/** Retire les accents et met en minuscules, sans rien decider d'autre. */
function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Reduit un nom d'entreprise a sa forme comparable.
 *
 * Rend une chaine vide quand il ne reste rien : un nom qui n'etait qu'une
 * forme juridique ne designe aucune entreprise, et le dire par une chaine vide
 * evite de creer une entreprise appelee « sarl ».
 */
export function normalizeCompanyName(name: string): string {
  let mots = fold(name)
    // L'esperluette se lit « et ». Sans cela, « Dupont & Fils » et « Dupont et
    // Fils » seraient deux entreprises differentes.
    .replace(/&/g, ' et ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((mot) => mot !== '');

  mots = mergeInitials(mots);

  // Une seule passe de chaque cote : « Dupont SAS SARL » est une faute de
  // saisie, pas deux formes a retirer.
  if (mots.length > 1 && LEGAL_FORMS.includes(mots[0] ?? '')) mots = mots.slice(1);
  if (mots.length > 1 && LEGAL_FORMS.includes(mots.at(-1) ?? '')) mots = mots.slice(0, -1);

  return mots.join(' ');
}

/**
 * Recolle les suites de lettres isolees.
 *
 * « S.A.S. » et « S A S » arrivent ici en trois mots d'une lettre. Sans cette
 * passe, la forme juridique ne serait jamais reconnue, et « DOCTOLIB S.A.S. »
 * ne rejoindrait pas « Doctolib ».
 */
function mergeInitials(mots: readonly string[]): string[] {
  const sortie: string[] = [];
  let serie: string[] = [];

  const vider = (): void => {
    if (serie.length >= 2) sortie.push(serie.join(''));
    else sortie.push(...serie);
    serie = [];
  };

  for (const mot of mots) {
    if (mot.length === 1) serie.push(mot);
    else {
      vider();
      sortie.push(mot);
    }
  }
  vider();

  return sortie;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Extrait le domaine d'une saisie qui peut etre un domaine nu, une URL
 * complete, ou une URL sans protocole.
 *
 * Rend undefined quand il n'y a pas de domaine exploitable. Une adresse IP est
 * refusee : une entreprise a un nom de domaine, et accepter une IP ouvrirait la
 * porte que la protection contre la falsification de requete doit tenir fermee.
 */
export function normalizeDomain(input: string): string | undefined {
  const brut = input.trim();
  if (brut === '') return undefined;

  // Une saisie qui porte deja un schema n'est acceptee que s'il est http ou
  // https. Sans ce controle, « mailto:contact@exemple.fr » n'a pas de « // »,
  // recevrait donc un « https:// » devant, et l'analyseur y lirait
  // « mailto:contact » comme identifiants et « exemple.fr » comme hote : une
  // adresse email deviendrait un domaine d'entreprise.
  const schema = /^([a-z][a-z0-9+.-]*):/i.exec(brut);
  if (schema !== null && !/^https?$/i.test(schema[1] ?? '')) return undefined;

  // Sans protocole, `new URL` echoue : on en ajoute un, ce qui est aussi ce que
  // demande F-301.
  const avecProtocole = /^https?:\/\//i.test(brut) ? brut : `https://${brut}`;

  let hote: string;
  try {
    const url = new URL(avecProtocole);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    // Des identifiants dans l'URL ne designent pas une entreprise.
    if (url.username !== '' || url.password !== '') return undefined;
    hote = url.hostname;
  } catch {
    return undefined;
  }

  // `hostname` rend deja la forme punycode d'un domaine internationalise, mais
  // pas dans tous les cas limites : on repasse dessus pour en etre sur.
  const ascii = domainToASCII(hote.replace(/\.$/, ''));
  if (ascii === '') return undefined;

  const sansWww = ascii.startsWith('www.') ? ascii.slice(4) : ascii;

  if (IPV4.test(sansWww) || sansWww.includes(':')) return undefined;
  // Un domaine a au moins un point et une extension alphabetique.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(sansWww)) return undefined;
  if (sansWww.includes('..') || sansWww.startsWith('-') || sansWww.startsWith('.')) {
    return undefined;
  }

  return sansWww;
}

/**
 * Normalise une URL de page, site ou carrieres : protocole ajoute, fragment
 * retire. Le chemin est garde, lui : c'est ce qui distingue une page carrieres
 * de la racine du site.
 */
export function normalizeUrl(input: string): string | undefined {
  const brut = input.trim();
  if (brut === '') return undefined;
  if (normalizeDomain(brut) === undefined) return undefined;

  const avecProtocole = /^[a-z][a-z0-9+.-]*:\/\//i.test(brut) ? brut : `https://${brut}`;

  try {
    const url = new URL(avecProtocole);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    // Une barre finale seule n'est pas une difference de page.
    if (url.pathname === '/') url.pathname = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

/** Neuf chiffres, espaces et points ignores. Rend undefined si ce n'en est pas un. */
export function normalizeSiren(input: string): string | undefined {
  const chiffres = input.replace(/[^0-9]/g, '');
  // Un SIRET est un SIREN suivi de cinq chiffres d'etablissement : on garde le
  // SIREN, qui designe l'entreprise.
  if (chiffres.length === 14) return chiffres.slice(0, 9);
  return chiffres.length === 9 ? chiffres : undefined;
}

/** Etiquettes separees par des virgules ou des points-virgules, dedoublonnees. */
export function normalizeTags(input: string): string[] {
  const vues = new Set<string>();
  for (const brut of input.split(/[;,]/)) {
    const etiquette = brut.trim().toLowerCase();
    if (etiquette !== '') vues.add(etiquette);
  }
  return [...vues];
}
