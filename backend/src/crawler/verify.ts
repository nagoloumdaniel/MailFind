/**
 * L'adresse figure-t-elle dans la page ? C'est la question de la Definition
 * of Done de la Phase 3, posee apres coup a la page citee comme source.
 *
 * Telle quelle, encodee dans un lien mailto, ou sous sa forme ecrite
 * (« contact [at] acme [point] fr ») : dans ce dernier cas, la partie locale
 * puis chaque morceau du domaine doivent apparaitre, dans l'ordre et a peu
 * de distance, sans quoi n'importe quelle page qui contient ces mots au
 * hasard passerait le controle.
 */
const ECART_MAX = 40;

export function appearsIn(page: string, adresse: string): boolean {
  const texte = page.toLowerCase();
  const cible = adresse.toLowerCase();
  if (texte.includes(cible) || texte.includes(encodeURIComponent(cible).toLowerCase())) {
    return true;
  }

  const [locale = '', domaine = ''] = cible.split('@');
  const morceaux = [locale, ...domaine.split('.')];
  for (
    let depart = texte.indexOf(locale);
    depart !== -1;
    depart = texte.indexOf(locale, depart + 1)
  ) {
    let position = depart + locale.length;
    let trouve = true;
    for (const morceau of morceaux.slice(1)) {
      const suivante = texte.indexOf(morceau, position);
      if (suivante === -1 || suivante - position > ECART_MAX) {
        trouve = false;
        break;
      }
      position = suivante + morceau.length;
    }
    if (trouve) return true;
  }
  return false;
}
