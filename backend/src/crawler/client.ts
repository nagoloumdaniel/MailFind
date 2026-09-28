import { registrableDomain } from '../net/domain.js';
import type { FetchedPage, Fetcher } from '../net/safe-fetch.js';
import type { DomainGate } from './politeness.js';
import { ALLOW_ALL, DISALLOW_ALL, parseRobots, productToken, type RobotsRules } from './robots.js';

/**
 * Ce que le moteur de collecte appelle pour lire une page d'un site.
 *
 * Il ne peut pas contourner les regles : robots.txt est lu avant la premiere
 * page de chaque site et respecte pour toutes les suivantes (F-403), et chaque
 * requete, robots.txt compris, passe par la file du domaine (F-405). Une page
 * interdite n'est jamais demandee, pas meme pour voir.
 */

export type CrawlOutcome =
  | { readonly kind: 'page'; readonly page: FetchedPage }
  | { readonly kind: 'disallowed' }
  | { readonly kind: 'failed'; readonly reason: string };

export interface CrawlerClient {
  get(url: string): Promise<CrawlOutcome>;
}

export interface CrawlerClientOptions {
  readonly fetcher: Fetcher;
  readonly gate: DomainGate;
  readonly userAgent: string;
  /** Intervalle minimal entre deux requetes sur un domaine (F-405). */
  readonly minIntervalMs: number;
}

/** La RFC 9309 admet une mise en cache jusqu'a 24 heures. */
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;
const ROBOTS_CACHE_MAX = 2000;

/**
 * Ce que dit le code de reponse de robots.txt, selon la RFC 9309 :
 * introuvable ou refuse (4xx), le site n'a rien interdit ; en panne (5xx) ou
 * injoignable, on ne sait pas ce qu'il interdit, donc on ne visite rien. 429
 * est traite comme une panne : un site qui demande de ralentir ne demande pas
 * qu'on vienne quand meme.
 */
export function rulesForStatus(status: number, body: string, token: string): RobotsRules {
  if (status >= 200 && status < 300) return parseRobots(body, token);
  if (status === 429) return DISALLOW_ALL;
  if (status >= 400 && status < 500) return ALLOW_ALL;
  return DISALLOW_ALL;
}

function raison(error: unknown): string {
  return error instanceof Error ? error.message : 'erreur inconnue';
}

export function createCrawlerClient(options: CrawlerClientOptions): CrawlerClient {
  const token = productToken(options.userAgent);
  // La promesse, et non la reponse : trois pages demandees en meme temps sur
  // un site encore inconnu ne doivent pas lire trois fois robots.txt.
  const robots = new Map<string, { regles: Promise<RobotsRules>; expire: number }>();

  async function lireRobots(origine: URL): Promise<RobotsRules> {
    try {
      const fichier = await options.gate.run(
        registrableDomain(origine.hostname),
        options.minIntervalMs,
        () => options.fetcher.fetchPage(`${origine.origin}/robots.txt`, { accept: 'text' }),
      );
      return rulesForStatus(fichier.status, fichier.body, token);
    } catch {
      return DISALLOW_ALL;
    }
  }

  function reglesDe(origine: URL): Promise<RobotsRules> {
    const cle = origine.origin;
    const connues = robots.get(cle);
    if (connues !== undefined && connues.expire > Date.now()) return connues.regles;

    if (robots.size >= ROBOTS_CACHE_MAX) {
      const plusAncienne = robots.keys().next().value;
      if (plusAncienne !== undefined) robots.delete(plusAncienne);
    }
    const regles = lireRobots(origine);
    robots.set(cle, { regles, expire: Date.now() + ROBOTS_TTL_MS });
    return regles;
  }

  return {
    async get(rawUrl) {
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        return { kind: 'failed', reason: 'adresse de page invalide' };
      }

      const regles = await reglesDe(url);
      if (!regles.isAllowed(`${url.pathname}${url.search}`)) return { kind: 'disallowed' };

      const intervalle = Math.max(options.minIntervalMs, regles.crawlDelayMs ?? 0);
      try {
        const page = await options.gate.run(registrableDomain(url.hostname), intervalle, () =>
          options.fetcher.fetchPage(url.toString()),
        );
        return { kind: 'page', page };
      } catch (error) {
        return { kind: 'failed', reason: raison(error) };
      }
    },
  };
}
