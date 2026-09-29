import type { RequestHandler, Response } from 'express';
import { AppError } from '../http/problem.js';
import { findUserById } from '../users/repository.js';
import { hashApiKey, looksLikeApiKey, type ApiScope } from './keys.js';
import { findActiveApiKey, touchApiKey } from './repository.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** La cle qui a authentifie la requete, posee par requireApiKey. */
    apiKey?: { readonly id: string; readonly scopes: readonly ApiScope[] };
  }
}

function cleRefusee(res: Response): AppError {
  // RFC 6750 : un 401 dit au client quel schema employer.
  res.setHeader('WWW-Authenticate', 'Bearer realm="MailFind"');
  return new AppError({
    status: 401,
    code: 'invalid_api_key',
    title: "Cle d'API refusee",
    detail: "Envoyez une cle d'API active dans l'en-tete Authorization: Bearer.",
  });
}

/**
 * La portee demandee par une route, sur une requete deja authentifiee par
 * requireApiKey (monte une fois pour tout le routeur `/v1`).
 */
export function requireScope(scope: ApiScope): RequestHandler {
  return (req, _res, next) => {
    if (req.apiKey?.scopes.includes(scope) === true) {
      next();
      return;
    }
    next(
      new AppError({
        status: 403,
        code: 'insufficient_scope',
        title: 'Portee insuffisante',
        detail: `Cette cle n'a pas la portee ${scope}.`,
      }),
    );
  };
}

/**
 * Authentifie une requete de l'API publique par sa cle (F-1302) et verifie
 * la portee demandee (F-1303). Pose le compte comme le ferait une session :
 * les regles metier ne savent pas par quel chemin la requete est arrivee.
 *
 * Une cle absente, mal formee, inconnue ou revoquee recoit la meme reponse :
 * dire laquelle aiderait qui essaie d'en deviner une.
 */
export function requireApiKey(scope?: ApiScope): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      try {
        const entete = req.get('authorization') ?? '';
        const [schema, secret] = entete.split(' ');
        if (
          schema?.toLowerCase() !== 'bearer' ||
          secret === undefined ||
          !looksLikeApiKey(secret)
        ) {
          next(cleRefusee(res));
          return;
        }
        const cle = await findActiveApiKey(hashApiKey(secret));
        const user = cle === undefined ? undefined : await findUserById(cle.userId);
        if (cle === undefined || user === undefined) {
          next(cleRefusee(res));
          return;
        }
        if (scope !== undefined && !cle.scopes.includes(scope)) {
          next(
            new AppError({
              status: 403,
              code: 'insufficient_scope',
              title: 'Portee insuffisante',
              detail: `Cette cle n'a pas la portee ${scope}.`,
            }),
          );
          return;
        }
        await touchApiKey(cle.id);
        req.apiKey = { id: cle.id, scopes: cle.scopes };
        req.currentUser = user;
        next();
      } catch (error) {
        next(error);
      }
    })();
  };
}
