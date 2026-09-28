import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent, request } from 'undici';
import { getEnvironment } from '../config/env.js';
import { isForbiddenHostname, isForbiddenIp } from './addresses.js';

/**
 * Le seul client HTTP autorise a joindre un site exterieur.
 *
 * Il porte, en un seul endroit, tout ce que le cahier des charges exige de la
 * collecte : un agent qui s'annonce (F-404), un delai d'expiration, une taille
 * maximale et des redirections bornees (F-405), et le refus des adresses non
 * publiques (S-05).
 *
 * Le controle des adresses est pose dans la resolution DNS elle-meme, pas
 * avant l'appel. C'est la difference entre verifier et empecher : un domaine
 * peut repondre une adresse publique a la verification puis une adresse privee
 * a la connexion, une seconde plus tard. En validant au moment ou la socket
 * s'ouvre, il n'y a plus d'intervalle a exploiter, et chaque redirection est
 * couverte sans avoir a y penser.
 */

export class BlockedAddressError extends Error {
  constructor(details: string) {
    super(`Adresse refusee : ${details}`);
    this.name = 'BlockedAddressError';
  }
}

export class PageTooLargeError extends Error {
  constructor(limit: number) {
    super(`Page trop volumineuse, au-dela de ${String(limit)} octets`);
    this.name = 'PageTooLargeError';
  }
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * Resolution DNS qui refuse toute adresse non publiquement routable.
 *
 * Toutes les adresses rendues sont examinees, pas seulement la premiere : un
 * nom peut en publier plusieurs, et il suffirait d'en laisser passer une.
 */
function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: LookupCallback,
): void {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, []);
      return;
    }

    const resolues = addresses;
    const interdite = resolues.find((adresse) => isForbiddenIp(adresse.address));
    if (interdite !== undefined) {
      const refus = new BlockedAddressError(
        `${hostname} resout vers ${interdite.address}`,
      ) as NodeJS.ErrnoException;
      refus.code = 'EBLOCKED';
      callback(refus, []);
      return;
    }

    if (options.all === true) {
      callback(null, resolues);
      return;
    }

    const premiere = resolues[0];
    if (premiere === undefined) {
      const vide = new Error(`${hostname} ne resout vers aucune adresse`) as NodeJS.ErrnoException;
      vide.code = 'ENOTFOUND';
      callback(vide, []);
      return;
    }
    callback(null, premiere.address, premiere.family);
  });
}

let agent: Agent | undefined;

function getAgent(): Agent {
  // `request` ne suit aucune redirection par defaut : elles sont traitees a la
  // main plus bas, pour pouvoir compter celles qui sortent du domaine.
  agent ??= new Agent({
    connect: { lookup: guardedLookup as unknown as LookupFunction, timeout: 10_000 },
  });
  return agent;
}

export async function closeSafeFetch(): Promise<void> {
  if (agent === undefined) return;
  const fermeture = agent;
  agent = undefined;
  await fermeture.close();
}

export interface FetchedPage {
  /** L'URL reellement lue, apres redirections. */
  readonly url: string;
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
  readonly redirects: number;
}

export interface FetchOptions {
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxOffDomainRedirects?: number;
}

/** Types de contenu que la collecte sait lire. Le reste est ignore. */
const READABLE = /^(text\/html|application\/xhtml\+xml|text\/plain)/i;

function registrableHost(hostname: string): string {
  // Comparaison volontairement grossiere : « www.exemple.fr » et
  // « careers.exemple.fr » comptent pour le meme domaine, ce qui suffit a
  // distinguer une redirection interne d'un saut vers un autre site.
  const parties = hostname.toLowerCase().split('.');
  return parties.slice(-2).join('.');
}

export async function fetchPage(rawUrl: string, options: FetchOptions = {}): Promise<FetchedPage> {
  const environment = getEnvironment();
  const timeoutMs = options.timeoutMs ?? environment.CRAWLER_REQUEST_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? environment.CRAWLER_MAX_RESPONSE_BYTES;
  const maxOffDomain = options.maxOffDomainRedirects ?? environment.CRAWLER_MAX_REDIRECTS;

  let url = new URL(rawUrl);
  const domaineDepart = registrableHost(url.hostname);
  let sorties = 0;

  // Une borne dure sur le nombre total de sauts, en plus de celle sur les
  // sorties de domaine : une boucle de redirections a l'interieur d'un site
  // tournerait sinon sans fin.
  for (let saut = 0; saut <= 10; saut += 1) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BlockedAddressError(`protocole ${url.protocol} refuse`);
    }
    if (isForbiddenHostname(url.hostname)) {
      throw new BlockedAddressError(url.hostname);
    }

    const reponse = await request(url, {
      method: 'GET',
      dispatcher: getAgent(),
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      headers: {
        'user-agent': environment.CRAWLER_USER_AGENT,
        accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8',
        'accept-language': 'fr,en;q=0.8',
      },
    });

    const emplacement = reponse.headers.location;
    const estRedirection = reponse.statusCode >= 300 && reponse.statusCode < 400;

    if (estRedirection && typeof emplacement === 'string' && emplacement !== '') {
      // Le corps d'une redirection ne sert a rien, mais le laisser ouvert
      // retiendrait la connexion.
      await reponse.body.dump();

      const suivante = new URL(emplacement, url);
      if (registrableHost(suivante.hostname) !== domaineDepart) {
        sorties += 1;
        if (sorties > maxOffDomain) {
          throw new BlockedAddressError(
            `trop de redirections hors du domaine (${String(sorties)})`,
          );
        }
      }
      url = suivante;
      continue;
    }

    const typeContenu = String(reponse.headers['content-type'] ?? '');
    if (!READABLE.test(typeContenu)) {
      await reponse.body.dump();
      return {
        url: url.toString(),
        status: reponse.statusCode,
        contentType: typeContenu,
        body: '',
        redirects: saut,
      };
    }

    // Lecture bornee : on s'arrete des le depassement plutot que de charger
    // une page de cent megaoctets pour la jeter ensuite.
    let taille = 0;
    const morceaux: Buffer[] = [];
    for await (const morceau of reponse.body) {
      const bloc = Buffer.isBuffer(morceau) ? morceau : Buffer.from(morceau as Uint8Array);
      taille += bloc.byteLength;
      if (taille > maxBytes) {
        await reponse.body.dump();
        throw new PageTooLargeError(maxBytes);
      }
      morceaux.push(bloc);
    }

    return {
      url: url.toString(),
      status: reponse.statusCode,
      contentType: typeContenu,
      body: Buffer.concat(morceaux).toString('utf8'),
      redirects: saut,
    };
  }

  throw new BlockedAddressError('boucle de redirections');
}
