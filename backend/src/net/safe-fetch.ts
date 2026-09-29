import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent, request } from 'undici';
import { getEnvironment } from '../config/env.js';
import { isForbiddenHostname, isForbiddenIp } from './addresses.js';
import { registrableDomain } from './domain.js';

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
 *
 * Le respect des sites (robots.txt, une requete par seconde et par domaine)
 * est au-dessus, dans `crawler/client.ts` : ce module-ci ne sait que lire une
 * page sans danger.
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

export class FetchTimeoutError extends Error {
  constructor(limitMs: number) {
    super(`Aucune reponse complete en ${String(limitMs / 1000)} secondes`);
    this.name = 'FetchTimeoutError';
  }
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

interface LookupOptions {
  all?: boolean;
  family?: number;
}

/**
 * Aiguillage des tests : quelques noms d'hote reserves, resolus vers la
 * machine locale, ou tourne le jeu de sites de la suite de tests (13.1).
 *
 * Sans lui, la garde refuserait a juste titre 127.0.0.1, et le moteur de
 * collecte ne pourrait etre teste que sur l'Internet reel. Tout le reste passe
 * par la garde normale, si bien que les tests de la garde tournent sur le meme
 * client que ceux du moteur. Interdit en production.
 */
export interface TestRouting {
  readonly port: number;
  readonly hosts: readonly string[];
}

export interface FetcherOptions {
  readonly testRouting?: TestRouting;
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
  /** Types de contenu acceptes. Par defaut, ce qu'une page web peut etre. */
  readonly accept?: 'page' | 'text';
}

export interface Fetcher {
  fetchPage(url: string, options?: FetchOptions): Promise<FetchedPage>;
  postJson(
    url: string,
    body: string,
    headers: Readonly<Record<string, string>>,
    options?: { readonly timeoutMs?: number },
  ): Promise<{ status: number }>;
  close(): Promise<void>;
}

/** Types de contenu que la collecte sait lire. Le reste est ignore. */
const READABLE = /^(text\/html|application\/xhtml\+xml|text\/plain)/i;

/** Au-dela de dix sauts, c'est une boucle, quel que soit le domaine. */
const MAX_HOPS = 10;

/**
 * Le jeu de caracteres annonce par l'en-tete, sinon par la page elle-meme.
 * Beaucoup de sites francais sont encore en Windows-1252 : les lire en UTF-8
 * transformerait « societe » accentuee en caracteres de remplacement, et une
 * adresse qui les voisine pourrait ne plus etre reconnue.
 */
function charsetOf(contentType: string, octets: Buffer): string {
  const entete = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (entete !== undefined) return entete.toLowerCase();
  const debut = octets.subarray(0, 2048).toString('latin1');
  const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(debut)?.[1];
  return meta?.toLowerCase() ?? 'utf-8';
}

function decode(octets: Buffer, contentType: string): string {
  try {
    return new TextDecoder(charsetOf(contentType, octets)).decode(octets);
  } catch {
    // Jeu de caracteres inconnu : UTF-8 remplace ce qu'il ne sait pas lire,
    // ce qui vaut mieux qu'une page perdue.
    return new TextDecoder('utf-8').decode(octets);
  }
}

/**
 * Lache un corps de reponse qu'on ne lira pas. Detruit sans erreur, undici
 * emet quand meme « Request aborted » : sans ecouteur, cette erreur remonte
 * comme non geree, alors qu'elle ne dit rien d'autre que ce qu'on a voulu.
 */
function abandonner(corps: NodeJS.ReadableStream & { destroy(): void }): void {
  corps.on('error', () => undefined);
  corps.destroy();
}

export function createFetcher(options: FetcherOptions = {}): Fetcher {
  const routage = options.testRouting;
  if (routage !== undefined && process.env.NODE_ENV === 'production') {
    throw new Error("L'aiguillage de test ne peut pas etre active en production.");
  }
  const hotesDeTest = new Set(routage?.hosts.map((hote) => hote.toLowerCase()) ?? []);
  const estHoteDeTest = (hostname: string) => hotesDeTest.has(hostname.toLowerCase());

  /**
   * Resolution DNS qui refuse toute adresse non publiquement routable.
   *
   * Toutes les adresses rendues sont examinees, pas seulement la premiere :
   * un nom peut en publier plusieurs, et il suffirait d'en laisser passer une.
   */
  function guardedLookup(hostname: string, lookupOptions: LookupOptions, callback: LookupCallback) {
    if (estHoteDeTest(hostname)) {
      if (lookupOptions.all === true) callback(null, [{ address: '127.0.0.1', family: 4 }]);
      else callback(null, '127.0.0.1', 4);
      return;
    }

    dnsLookup(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
      if (error) {
        callback(error, []);
        return;
      }

      const interdite = addresses.find((adresse) => isForbiddenIp(adresse.address));
      if (interdite !== undefined) {
        const refus = new BlockedAddressError(
          `${hostname} resout vers ${interdite.address}`,
        ) as NodeJS.ErrnoException;
        refus.code = 'EBLOCKED';
        callback(refus, []);
        return;
      }

      if (lookupOptions.all === true) {
        callback(null, addresses);
        return;
      }

      const premiere = addresses[0];
      if (premiere === undefined) {
        const vide = new Error(
          `${hostname} ne resout vers aucune adresse`,
        ) as NodeJS.ErrnoException;
        vide.code = 'ENOTFOUND';
        callback(vide, []);
        return;
      }
      callback(null, premiere.address, premiere.family);
    });
  }

  const environment = getEnvironment();
  // `request` ne suit aucune redirection par defaut : elles sont traitees a la
  // main plus bas, pour pouvoir compter celles qui sortent du domaine.
  const agent = new Agent({
    connect: {
      lookup: guardedLookup as unknown as LookupFunction,
      timeout: environment.CRAWLER_REQUEST_TIMEOUT_MS,
    },
  });

  /** L'URL a laquelle on se connecte vraiment : celle du jeu de test, en local. */
  function cible(url: URL): URL {
    if (routage === undefined || !estHoteDeTest(url.hostname)) return url;
    const locale = new URL(url.toString());
    locale.protocol = 'http:';
    locale.port = String(routage.port);
    return locale;
  }

  async function lire(rawUrl: string, fetchOptions: FetchOptions, signal: AbortSignal) {
    const maxBytes = fetchOptions.maxBytes ?? environment.CRAWLER_MAX_RESPONSE_BYTES;
    const maxOffDomain = fetchOptions.maxOffDomainRedirects ?? environment.CRAWLER_MAX_REDIRECTS;
    const lisible = fetchOptions.accept === 'text' ? /^text\/plain/i : READABLE;

    let url = new URL(rawUrl);
    const domaineDepart = registrableDomain(url.hostname);
    let sorties = 0;

    for (let saut = 0; saut <= MAX_HOPS; saut += 1) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new BlockedAddressError(`protocole ${url.protocol} refuse`);
      }
      if (!estHoteDeTest(url.hostname) && isForbiddenHostname(url.hostname)) {
        throw new BlockedAddressError(url.hostname);
      }

      const reponse = await request(cible(url), {
        method: 'GET',
        dispatcher: agent,
        signal,
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
        abandonner(reponse.body);

        const suivante = new URL(emplacement, url);
        if (registrableDomain(suivante.hostname) !== domaineDepart) {
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
      // Un fichier texte sans type annonce reste lisible pour robots.txt.
      if (!lisible.test(typeContenu) && !(fetchOptions.accept === 'text' && typeContenu === '')) {
        abandonner(reponse.body);
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
          abandonner(reponse.body);
          throw new PageTooLargeError(maxBytes);
        }
        morceaux.push(bloc);
      }

      return {
        url: url.toString(),
        status: reponse.statusCode,
        contentType: typeContenu,
        body: decode(Buffer.concat(morceaux), typeContenu),
        redirects: saut,
      };
    }

    throw new BlockedAddressError('boucle de redirections');
  }

  return {
    /**
     * Le delai couvre tout : resolution, redirections et lecture du corps. Les
     * delais propres a undici ne comptent que l'inactivite, si bien qu'un site
     * qui distille un octet toutes les neuf secondes les respecterait tous en
     * tenant la connexion indefiniment.
     */
    async fetchPage(rawUrl, fetchOptions = {}) {
      const delai = fetchOptions.timeoutMs ?? environment.CRAWLER_REQUEST_TIMEOUT_MS;
      // Un minuteur annule a la fin, et non `AbortSignal.timeout` : celui-ci
      // continue de courir apres la lecture, et viendrait interrompre plus
      // tard des corps deja termines, en erreurs que personne n'ecoute.
      const controleur = new AbortController();
      const minuteur = setTimeout(() => {
        controleur.abort();
      }, delai);
      try {
        return await lire(rawUrl, fetchOptions, controleur.signal);
      } catch (error) {
        if (controleur.signal.aborted) throw new FetchTimeoutError(delai);
        throw error;
      } finally {
        clearTimeout(minuteur);
      }
    },
    /**
     * Un POST JSON par le meme agent, donc la meme resolution gardee : c'est
     * le chemin des webhooks (S-05). Aucune redirection n'est suivie : un 3xx
     * est rendu tel quel, et le webhook le compte comme un echec. Suivre une
     * redirection enverrait le corps signe la ou le client n'a rien declare.
     */
    async postJson(rawUrl, body, headers, postOptions = {}) {
      const url = new URL(rawUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new BlockedAddressError(`protocole ${url.protocol} refuse`);
      }
      if (!estHoteDeTest(url.hostname) && isForbiddenHostname(url.hostname)) {
        throw new BlockedAddressError(url.hostname);
      }
      const delai = postOptions.timeoutMs ?? environment.CRAWLER_REQUEST_TIMEOUT_MS;
      const controleur = new AbortController();
      const minuteur = setTimeout(() => {
        controleur.abort();
      }, delai);
      try {
        const reponse = await request(cible(url), {
          method: 'POST',
          dispatcher: agent,
          signal: controleur.signal,
          headers: { ...headers, 'content-type': 'application/json' },
          body,
        });
        // Le corps de la reponse ne sert a rien : seul le statut compte.
        abandonner(reponse.body);
        return { status: reponse.statusCode };
      } catch (error) {
        if (controleur.signal.aborted) throw new FetchTimeoutError(delai);
        throw error;
      } finally {
        clearTimeout(minuteur);
      }
    },
    async close() {
      await agent.close();
    },
  };
}
