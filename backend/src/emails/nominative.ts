/**
 * Adresses nominatives deduites (F-504), sous deux conditions cumulees :
 * l'utilisateur a lui-meme donne le nom de la personne dans son import, et
 * un format d'adresse a ete observe sur le domaine, par un fournisseur. Jamais
 * par combinaison de noms trouves ailleurs.
 */

function replier(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z-]/g, '');
}

/** « Jean-Paul de la Tour » : prenom « jean-paul », nom « delatour ». */
export function splitName(nom: string): { first: string; last: string } | undefined {
  const mots = nom
    .trim()
    .split(/\s+/)
    .filter((mot) => mot !== '');
  if (mots.length < 2) return undefined;
  const first = replier(mots[0] ?? '');
  const last = replier(mots.slice(1).join('')).replace(/-/g, '');
  return first.length >= 2 && last.length >= 2 ? { first, last } : undefined;
}

/**
 * Les formats que Hunter annonce, et eux seuls : un format inconnu ne donne
 * rien plutot qu'une adresse inventee.
 */
const JETONS = /^(\{first\}|\{last\}|\{f\}|\{l\})([._-]?)(\{first\}|\{last\}|\{f\}|\{l\})?$/;

export function applyPattern(
  pattern: string,
  personne: { first: string; last: string },
  domaine: string,
): string | undefined {
  const correspondance = JETONS.exec(pattern.trim());
  if (correspondance === null) return undefined;
  const [, a, separateur = '', b] = correspondance;
  const valeur = (jeton: string | undefined): string => {
    switch (jeton) {
      case '{first}':
        return personne.first;
      case '{last}':
        return personne.last;
      case '{f}':
        return personne.first.slice(0, 1);
      case '{l}':
        return personne.last.slice(0, 1);
      default:
        return '';
    }
  };
  const locale = `${valeur(a)}${b === undefined ? '' : separateur}${valeur(b)}`;
  return /^[a-z][a-z._-]*[a-z]$/.test(locale) ? `${locale}@${domaine}` : undefined;
}
