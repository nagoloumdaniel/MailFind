import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, PROBLEM_CONTENT_TYPE, toProblem } from '../problem.js';

/** Toute route inconnue devient une erreur attendue, pas une page vide. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(AppError.notFound("Cette route n'existe pas."));
};

/**
 * Dernier maillon de la chaine. Une erreur inattendue ne sort jamais telle
 * quelle : son message peut contenir une chaine de connexion, un jeton ou une
 * adresse (S-03). Elle est journalisee en entier, et rendue en « erreur
 * interne » accompagnee de l'identifiant de requete, seul lien entre ce que
 * voit l'utilisateur et ce que voit l'exploitant.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const requestId = typeof req.id === 'string' ? req.id : undefined;

  const appError =
    error instanceof AppError
      ? error
      : new AppError({
          status: 500,
          code: 'internal_error',
          title: 'Erreur interne',
          detail: "La requete n'a pas pu aboutir. L'incident a ete enregistre.",
        });

  if (appError.status >= 500) {
    req.log.error({ err: error }, 'requete en echec');
  } else {
    req.log.warn({ code: appError.code, status: appError.status }, 'requete refusee');
  }

  // Une reponse deja commencee ne peut plus changer de statut ni d'en-tetes.
  if (res.headersSent) {
    res.end();
    return;
  }

  res.status(appError.status).type(PROBLEM_CONTENT_TYPE).json(toProblem(appError, requestId));
};
