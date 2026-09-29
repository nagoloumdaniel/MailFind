import type { RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import { AppError } from '../http/problem.js';

/**
 * Limitation de debit par cle d'API (F-1304) : une fenetre fixe d'une
 * minute, comptee dans Redis pour que toutes les instances de l'API partagent
 * le meme compteur.
 *
 * Les en-tetes suivent le brouillon IETF « RateLimit header fields » :
 * `RateLimit-Limit`, `RateLimit-Remaining` et `RateLimit-Reset` (secondes
 * avant la fenetre suivante), plus `Retry-After` sur un 429.
 */

export interface RateLimitHit {
  /** Requetes comptees dans la fenetre, celle-ci comprise. */
  readonly count: number;
  /** Millisecondes avant la fin de la fenetre. */
  readonly resetMs: number;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<RateLimitHit>;
}

/** Pour les tests et un processus seul : chaque instance aurait sinon son compteur. */
export function createMemoryRateLimitStore(now: () => number = Date.now): RateLimitStore {
  const fenetres = new Map<string, { count: number; endsAt: number }>();
  return {
    hit(key, windowMs) {
      const maintenant = now();
      const courante = fenetres.get(key);
      const fenetre =
        courante === undefined || courante.endsAt <= maintenant
          ? { count: 0, endsAt: maintenant + windowMs }
          : courante;
      fenetre.count += 1;
      fenetres.set(key, fenetre);
      return Promise.resolve({ count: fenetre.count, resetMs: fenetre.endsAt - maintenant });
    },
  };
}

// Compter et poser l'expiration dans le meme script : une panne entre les deux
// laisserait un compteur sans fin, qui bloquerait la cle pour toujours.
const COMPTER = `
local n = redis.call('incr', KEYS[1])
if n == 1 then redis.call('pexpire', KEYS[1], ARGV[1]) end
return {n, redis.call('pttl', KEYS[1])}
`;

export function createRedisRateLimitStore(redis: Redis, prefix: string): RateLimitStore {
  return {
    async hit(key, windowMs) {
      const [count, pttl] = (await redis.eval(COMPTER, 1, `${prefix}${key}`, String(windowMs))) as [
        number,
        number,
      ];
      return { count, resetMs: pttl > 0 ? pttl : windowMs };
    },
  };
}

export function rateLimit(options: {
  readonly store: () => RateLimitStore;
  readonly limit: number;
  readonly windowMs?: number;
  /** Une panne du compteur ne doit pas couper l'API : la requete passe, et c'est journalise. */
  readonly onStoreError?: (error: unknown) => void;
}): RequestHandler {
  const fenetre = options.windowMs ?? 60_000;
  return (req, res, next) => {
    void (async () => {
      const cle = req.apiKey?.id;
      if (cle === undefined) {
        next();
        return;
      }
      let coup: RateLimitHit;
      try {
        coup = await options.store().hit(`api:${cle}`, fenetre);
      } catch (error) {
        options.onStoreError?.(error);
        next();
        return;
      }
      const reset = Math.max(1, Math.ceil(coup.resetMs / 1000));
      res.setHeader('RateLimit-Limit', String(options.limit));
      res.setHeader('RateLimit-Remaining', String(Math.max(0, options.limit - coup.count)));
      res.setHeader('RateLimit-Reset', String(reset));
      if (coup.count > options.limit) {
        res.setHeader('Retry-After', String(reset));
        next(
          new AppError({
            status: 429,
            code: 'rate_limited',
            title: 'Trop de requetes',
            detail: `${String(options.limit)} requetes par minute au plus pour cette cle. Reessayez dans ${String(reset)} s.`,
          }),
        );
        return;
      }
      next();
    })();
  };
}
