import type { RequestHandler } from 'express';
import session from 'express-session';

/**
 * Session en memoire pour les tests. La vraie session vit dans Redis, mais ce
 * qu'il y a a verifier ici est le comportement des routes, pas le magasin.
 */
export function createTestSession(): RequestHandler {
  return session({
    name: 'mailfind.sid',
    secret: 'secret-de-test-suffisamment-long-pour-le-schema',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, sameSite: 'lax' },
  });
}
