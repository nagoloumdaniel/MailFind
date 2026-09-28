import { isIP } from 'node:net';

/**
 * Adresses IP que MailFind ne visite jamais (S-05).
 *
 * Le danger n'est pas theorique : une entreprise importee peut porter un nom
 * de domaine qui resout vers 169.254.169.254, l'adresse des metadonnees des
 * hebergeurs cloud, et une requete partie de nos serveurs y lirait des
 * identifiants d'infrastructure. Le meme raisonnement vaut pour le reseau
 * prive de l'hebergeur, pour la boucle locale, et pour tout ce qui n'est pas
 * une adresse publique de l'Internet.
 *
 * La liste refuse par defaut : ce qui n'est pas reconnu comme publiquement
 * routable est refuse.
 */

/** Plages IPv4 interdites, en notation CIDR, avec la raison de leur presence. */
const FORBIDDEN_IPV4: readonly [string, number][] = [
  ['0.0.0.0', 8], // « ce reseau »
  ['10.0.0.0', 8], // prive
  ['100.64.0.0', 10], // partage entre operateurs
  ['127.0.0.0', 8], // boucle locale
  ['169.254.0.0', 16], // lien local, dont 169.254.169.254 : metadonnees cloud
  ['172.16.0.0', 12], // prive
  ['192.0.0.0', 24], // affectations speciales IETF
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // relais 6to4 abandonne
  ['192.168.0.0', 16], // prive
  ['198.18.0.0', 15], // bancs de test
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multidiffusion
  ['240.0.0.0', 4], // reserve, dont 255.255.255.255
];

function ipv4ToNumber(address: string): number | undefined {
  const parties = address.split('.');
  if (parties.length !== 4) return undefined;

  let valeur = 0;
  for (const partie of parties) {
    if (!/^\d{1,3}$/.test(partie)) return undefined;
    const octet = Number(partie);
    if (octet > 255) return undefined;
    valeur = valeur * 256 + octet;
  }
  return valeur;
}

function inCidr(address: number, base: string, bits: number): boolean {
  const reference = ipv4ToNumber(base);
  if (reference === undefined) return false;
  // Un decalage de 32 est indefini en JavaScript : /0 couvre tout.
  const masque = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (address & masque) >>> 0 === (reference & masque) >>> 0;
}

/** Prefixes IPv6 interdits, en minuscules et sans abreviation trompeuse. */
const FORBIDDEN_IPV6_PREFIXES = [
  '::', // non specifie et boucle locale, traites a part ci-dessous
  '64:ff9b:', // traduction vers IPv4
  '100:', // trou noir
  '2001:db8:', // documentation
  'fc', // unique local, fc00::/7
  'fd',
  'fe8', // lien local, fe80::/10
  'fe9',
  'fea',
  'feb',
  'fec', // site local, abandonne mais encore rencontre
  'fed',
  'fee',
  'fef',
  'ff', // multidiffusion
];

function isForbiddenIpv6(address: string): boolean {
  const normalise = address.toLowerCase().split('%')[0] ?? '';

  if (normalise === '::' || normalise === '::1') return true;

  // Une adresse IPv4 habillee en IPv6 reste une adresse IPv4 : la juger
  // autrement laisserait passer ::ffff:127.0.0.1.
  const mappee = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(normalise);
  if (mappee?.[1] !== undefined) return isForbiddenIp(mappee[1]);

  return FORBIDDEN_IPV6_PREFIXES.some(
    (prefixe) => prefixe !== '::' && normalise.startsWith(prefixe),
  );
}

/** Vrai quand cette adresse ne doit jamais etre jointe depuis nos serveurs. */
export function isForbiddenIp(address: string): boolean {
  const version = isIP(address);

  if (version === 4) {
    const valeur = ipv4ToNumber(address);
    if (valeur === undefined) return true;
    return FORBIDDEN_IPV4.some(([base, bits]) => inCidr(valeur, base, bits));
  }

  if (version === 6) return isForbiddenIpv6(address);

  // Ni IPv4 ni IPv6 : on ne sait pas ce que c'est, donc on n'y va pas.
  return true;
}

/** Noms d'hote refuses avant meme toute resolution. */
const FORBIDDEN_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  // Raccourci des metadonnees sur Google Cloud et Alibaba.
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
]);

export function isForbiddenHostname(hostname: string): boolean {
  // `URL.hostname` rend une adresse IPv6 entre crochets. Sans les retirer,
  // « [::1] » ne serait pas reconnu comme une adresse, passerait la porte, et
  // ne serait arrete que par hasard, plus loin.
  const nom = hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[(.+)\]$/, '$1');
  if (nom === '') return true;
  if (FORBIDDEN_HOSTNAMES.has(nom)) return true;

  // Domaines reserves a l'usage local : ils ne designent jamais un site
  // d'entreprise sur l'Internet public.
  if (/\.(local|localhost|internal|intranet|home|lan|corp|localdomain)$/.test(nom)) return true;

  // Un nom d'hote qui est deja une adresse IP passe par la regle des adresses.
  if (isIP(nom) !== 0) return isForbiddenIp(nom);

  return false;
}
