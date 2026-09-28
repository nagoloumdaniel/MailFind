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

/**
 * Les huit groupes de seize bits d'une adresse IPv6, ou `undefined` si elle
 * est mal formee.
 *
 * Comparer des prefixes de texte ne suffit pas : une meme adresse s'ecrit de
 * plusieurs facons, et le parseur d'URL en choisit une que l'on n'attend pas.
 * « [::ffff:169.254.169.254] » devient « [::ffff:a9fe:a9fe] » dans
 * `URL.hostname`, et cette forme passait la porte. On juge donc des nombres,
 * pas une ecriture.
 */
function parseIpv6(address: string): number[] | undefined {
  let texte = address.toLowerCase();

  // Une IPv4 en fin d'adresse vaut deux groupes.
  const ipv4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(texte);
  if (ipv4?.[1] !== undefined) {
    const valeur = ipv4ToNumber(ipv4[1]);
    if (valeur === undefined) return undefined;
    const haut = Math.floor(valeur / 0x10000).toString(16);
    const bas = (valeur % 0x10000).toString(16);
    texte = `${texte.slice(0, -ipv4[1].length)}${haut}:${bas}`;
  }

  const moities = texte.split('::');
  if (moities.length > 2) return undefined;

  const lire = (partie: string): number[] | undefined => {
    if (partie === '') return [];
    const groupes: number[] = [];
    for (const groupe of partie.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(groupe)) return undefined;
      groupes.push(Number.parseInt(groupe, 16));
    }
    return groupes;
  };

  const avant = lire(moities[0] ?? '');
  const apres = lire(moities[1] ?? '');
  if (avant === undefined || apres === undefined) return undefined;

  if (moities.length === 1) return avant.length === 8 ? avant : undefined;

  const manquants = 8 - avant.length - apres.length;
  if (manquants < 1) return undefined;
  return [...avant, ...Array<number>(manquants).fill(0), ...apres];
}

function isForbiddenIpv6(address: string): boolean {
  const groupes = parseIpv6(address.split('%')[0] ?? '');
  if (groupes === undefined) return true;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groupes;

  // Une IPv4 habillee en IPv6 (::ffff:0:0/96) reste une IPv4 : elle est jugee
  // comme telle, sinon ::ffff:127.0.0.1 ouvrirait ce que le reste ferme.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return isForbiddenIp(
      `${String(g6 >> 8)}.${String(g6 & 0xff)}.${String(g7 >> 8)}.${String(g7 & 0xff)}`,
    );
  }

  // Refus par defaut : seul l'unicast global, 2000::/3, designe un site de
  // l'Internet public. Cela ecarte d'un coup la boucle locale, ::, les IPv4
  // compatibles, NAT64 (64:ff9b::/96), le trou noir (100::/64), les adresses
  // locales uniques (fc00::/7), le lien local (fe80::/10) et la multidiffusion.
  if ((g0 & 0xe000) !== 0x2000) return true;

  // Dans 2000::/3, les plages a usage special.
  if (g0 === 0x2001 && g1 < 0x0200) return true; // 2001::/23 : Teredo, bancs de test, ORCHID
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  if (g0 === 0x2002) return true; // 6to4 : embarque une IPv4 qu'il faudrait juger a part
  if ((g0 & 0xfff0) === 0x3ff0) return true; // 3fff::/20 : documentation

  return false;
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
