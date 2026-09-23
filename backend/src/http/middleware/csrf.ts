import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { AppError } from '../problem.js';

/**
 * Protection contre la falsification de requete entre sites (S-09).
 *
 * Le cookie de session est en `sameSite=lax`, ce qui arrete deja la plupart
 * des attaques, mais pas toutes : `lax` laisse passer une navigation de haut
 * niveau, et un formulaire poste depuis un autre site en est une. Le jeton
 * ferme cette porte.
 *
 * Double soumission : le jeton vit dans la session, et sa copie dans un cookie
 * lisible par le JavaScript de l'application, qui le renvoie en en-tete. Un
 * autre site ne peut ni lire ce cookie ni poser cet en-tete.
 */
export const CSRF_COOKIE = 'mailfind.csrf';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual exige deux tampons de meme longueur.
  return left.length === right.length && timingSafeEqual(left, right);
}

export const csrfProtection: RequestHandler = (req, res, next) => {
  req.session.csrfToken ??= randomBytes(32).toString('hex');
  const expected = req.session.csrfToken;

  res.cookie(CSRF_COOKIE, expected, {
    // Lisible par l'application : c'est tout l'interet de la double
    // soumission. Le secret reste le cookie de session, qui lui est httpOnly.
    httpOnly: false,
    secure: req.secure,
    sameSite: 'lax',
    path: '/',
  });

  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const provided = req.get(CSRF_HEADER);
  if (provided === undefined || !equals(provided, expected)) {
    next(
      new AppError({
        status: 403,
        code: 'csrf_token_invalid',
        title: 'Requete refusee',
        detail: 'Rechargez la page puis reessayez.',
      }),
    );
    return;
  }

  next();
};
