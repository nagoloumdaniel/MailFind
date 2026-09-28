/**
 * Le domaine « enregistrable » d'un hote, de facon volontairement grossiere :
 * « www.exemple.fr » et « careers.exemple.fr » donnent tous deux « exemple.fr ».
 *
 * Cela suffit aux deux usages d'ici : distinguer une redirection interne d'un
 * saut vers un autre site, et regrouper les requetes par domaine pour la
 * politesse (F-405). Les suffixes a deux niveaux, « co.uk » ou « gouv.fr »,
 * sont reconnus pour les plus courants : sans eux, deux sites britanniques
 * sans rapport partageraient la meme file d'attente.
 */
const SUFFIXES_DOUBLES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'co.jp',
  'com.br',
  'co.nz',
  'gouv.fr',
  'asso.fr',
  'com.fr',
  'co.za',
]);

export function registrableDomain(hostname: string): string {
  const parties = hostname.toLowerCase().replace(/\.$/, '').split('.');
  const deux = parties.slice(-2).join('.');
  return SUFFIXES_DOUBLES.has(deux) ? parties.slice(-3).join('.') : deux;
}
