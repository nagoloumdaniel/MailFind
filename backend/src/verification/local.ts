import { promises as dns } from 'node:dns';
import { domainToASCII } from 'node:url';
import { classifyLocalPart, type EmailType } from '../emails/roles.js';

/**
 * Controles locaux d'une adresse, niveaux 1 a 7 de la section 6.7. Ils sont
 * gratuits et ne sondent aucune boite : aucune connexion SMTP ne part de nos
 * serveurs (D-09). Du moins couteux au plus couteux, et la liste de
 * suppression juste apres la syntaxe : une adresse supprimee ne declenche
 * meme pas une requete DNS.
 */

export type LocalStatus = 'invalid' | 'disposable' | 'suppressed' | 'risky' | 'unverified';

export interface LocalVerdict {
  readonly status: LocalStatus;
  /** Le niveau ou le verdict s'est decide, ou 7 quand tous sont passes. */
  readonly level: number;
  readonly reason: string;
  /** Adresse normalisee, domaine en punycode. Absente si la syntaxe est refusee. */
  readonly normalized?: string;
  readonly type: EmailType;
  readonly webmail: boolean;
  /** Le domaine recoit du courrier : par MX, ou par A en repli (RFC 5321). */
  readonly mailServer?: 'mx' | 'a';
  /** Le DNS n'a pas repondu : rien n'est conclu sur le domaine. */
  readonly dnsUnknown?: boolean;
}

export interface MailDns {
  mx(domain: string): Promise<{ exchange: string; priority: number }[]>;
  hasAddress(domain: string): Promise<boolean>;
}

export interface LocalContext {
  readonly dns: MailDns;
  readonly isDisposable: (domain: string) => boolean;
  readonly isSuppressed: (normalized: string) => boolean;
}

/** Niveau 6 : messageries grand public, signalees pour un usage professionnel. */
const WEBMAILS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'outlook.fr',
  'hotmail.com',
  'hotmail.fr',
  'live.com',
  'live.fr',
  'msn.com',
  'yahoo.com',
  'yahoo.fr',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'orange.fr',
  'wanadoo.fr',
  'free.fr',
  'sfr.fr',
  'neuf.fr',
  'laposte.net',
  'bbox.fr',
  'gmx.fr',
  'gmx.com',
  'gmx.de',
  'protonmail.com',
  'proton.me',
  'zoho.com',
  'yandex.com',
  'mail.com',
]);

export function isWebmail(domain: string): boolean {
  return WEBMAILS.has(domain);
}

/**
 * Niveau 1 : un sous-ensemble strict de la RFC 5321, ce qu'une entreprise
 * publie vraiment, avec le domaine internationalise converti en punycode.
 */
export function normalizeAddress(address: string): string | undefined {
  const brute = address.trim();
  const arobase = brute.lastIndexOf('@');
  if (arobase <= 0 || arobase === brute.length - 1) return undefined;
  const locale = brute.slice(0, arobase).toLowerCase();
  const domaine = domainToASCII(
    brute
      .slice(arobase + 1)
      .toLowerCase()
      .replace(/\.$/, ''),
  );

  if (locale.length > 64 || !/^[a-z0-9._%+-]+$/.test(locale)) return undefined;
  if (locale.startsWith('.') || locale.endsWith('.') || locale.includes('..')) return undefined;
  if (domaine === '' || domaine.length > 253) return undefined;
  const etiquettes = domaine.split('.');
  if (etiquettes.length < 2) return undefined;
  for (const etiquette of etiquettes) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(etiquette)) return undefined;
  }
  const extension = etiquettes.at(-1) ?? '';
  if (!/^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(extension)) return undefined;

  const adresse = `${locale}@${domaine}`;
  return adresse.length <= 254 ? adresse : undefined;
}

type ServeurCourrier = 'mx' | 'a' | 'null_mx' | 'none' | 'unknown';

async function serveurDeCourrier(domaine: string, resolveur: MailDns): Promise<ServeurCourrier> {
  try {
    const mx = await resolveur.mx(domaine);
    // RFC 7505 : un MX unique vers « . » dit que le domaine ne recoit rien.
    if (
      mx.length > 0 &&
      mx.every(
        (enregistrement) => enregistrement.exchange === '' || enregistrement.exchange === '.',
      )
    ) {
      return 'null_mx';
    }
    if (mx.length > 0) return 'mx';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOTFOUND' || code === 'NXDOMAIN') return 'none';
    if (code !== 'ENODATA') return 'unknown';
  }
  // Pas de MX : la norme permet de livrer a l'adresse A du domaine.
  try {
    return (await resolveur.hasAddress(domaine)) ? 'a' : 'none';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN' ? 'none' : 'unknown';
  }
}

export async function checkLocally(address: string, contexte: LocalContext): Promise<LocalVerdict> {
  const normalized = normalizeAddress(address);
  if (normalized === undefined) {
    return {
      status: 'invalid',
      level: 1,
      reason: 'Adresse mal formee.',
      type: 'unknown',
      webmail: false,
    };
  }
  const [locale = '', domaine = ''] = normalized.split('@');
  const type = classifyLocalPart(locale);
  const webmail = isWebmail(domaine);
  const commun = { normalized, type, webmail };

  if (contexte.isSuppressed(normalized)) {
    return {
      ...commun,
      status: 'suppressed',
      level: 7,
      reason: 'Adresse dans votre liste de suppression.',
    };
  }
  if (contexte.isDisposable(domaine)) {
    return { ...commun, status: 'disposable', level: 4, reason: 'Domaine d adresses jetables.' };
  }

  const serveur = await serveurDeCourrier(domaine, contexte.dns);
  if (serveur === 'none') {
    return { ...commun, status: 'invalid', level: 2, reason: "Le domaine n'existe pas." };
  }
  if (serveur === 'null_mx') {
    return {
      ...commun,
      status: 'invalid',
      level: 3,
      reason: 'Le domaine declare ne recevoir aucun courrier (MX nul).',
    };
  }

  const dnsInconnu = serveur === 'unknown';
  const base = {
    ...commun,
    level: 7,
    ...(dnsInconnu ? { dnsUnknown: true } : { mailServer: serveur }),
  };

  // D-17 : une adresse de role garde son statut, elle est seulement typee.
  if (webmail) {
    return {
      ...base,
      status: 'risky',
      reason: 'Messagerie grand public, a verifier avant un usage professionnel.',
    };
  }
  return {
    ...base,
    status: 'unverified',
    reason: dnsInconnu
      ? 'Serveurs de messagerie non verifiables pour le moment.'
      : 'Controles locaux passes ; boite non verifiee.',
  };
}

/** Au-dela, le cache est vide : le processus tourne des semaines. */
const CACHE_DNS_MAX = 5000;

/** Le resolveur reel, avec un cache par domaine le temps d'une verification. */
export function createMailDns(ttlMs = 60 * 60 * 1000): MailDns {
  // Un delai court et deux essais : une liste de mille adresses ne doit pas
  // attendre vingt secondes chaque domaine qui ne repond pas.
  const resolveur = new dns.Resolver({ timeout: 3000, tries: 2 });
  const mx = new Map<
    string,
    { expire: number; valeur: Promise<{ exchange: string; priority: number }[]> }
  >();
  const adresses = new Map<string, { expire: number; valeur: Promise<boolean> }>();
  const memoriser = <T>(
    cache: Map<string, { expire: number; valeur: Promise<T> }>,
    cle: string,
    calcul: () => Promise<T>,
  ) => {
    const connu = cache.get(cle);
    if (connu !== undefined && connu.expire > Date.now()) return connu.valeur;
    if (cache.size >= CACHE_DNS_MAX) cache.clear();
    const valeur = calcul();
    cache.set(cle, { expire: Date.now() + ttlMs, valeur });
    // Une erreur ne reste pas en cache : la prochaine demande retente.
    valeur.catch(() => cache.delete(cle));
    return valeur;
  };
  return {
    mx: (domaine) => memoriser(mx, domaine, () => resolveur.resolveMx(domaine)),
    hasAddress: (domaine) =>
      memoriser(adresses, domaine, async () => {
        const [v4, v6] = await Promise.allSettled([
          resolveur.resolve4(domaine),
          resolveur.resolve6(domaine),
        ]);
        if (v4.status === 'fulfilled' && v4.value.length > 0) return true;
        if (v6.status === 'fulfilled' && v6.value.length > 0) return true;
        const erreur = v4.status === 'rejected' ? (v4.reason as NodeJS.ErrnoException) : undefined;
        if (erreur !== undefined && erreur.code !== 'ENODATA' && erreur.code !== 'ENOTFOUND')
          throw erreur;
        return false;
      }),
  };
}
