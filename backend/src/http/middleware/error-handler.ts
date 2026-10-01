import type { ErrorRequestHandler, RequestHandler } from 'express';
import { reportError } from '../../observability/errors.js';
import { AppError, PROBLEM_CONTENT_TYPE, toProblem } from '../problem.js';

/** Toute route inconnue devient une erreur attendue, pas une page vide. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(AppError.notFound("Cette route n'existe pas."));
};

/**
 * Les refus du lecteur de corps (body-parser) sont des fautes du client, pas
 * des pannes : il les signale par un `type` stable.
 */
function erreurDeCorps(error: unknown): AppError | undefined {
  const type = (error as { type?: unknown } | null)?.type;
  if (type === 'entity.parse.failed') {
    return AppError.badRequest(
      'invalid_json',
      'Corps illisible',
      "Le corps n'est pas un JSON valide.",
    );
  }
  if (type === 'entity.too.large') {
    return new AppError({
      status: 413,
      code: 'payload_too_large',
      title: 'Corps trop volumineux',
      detail: 'Le corps de la requete depasse la taille admise pour cette route.',
    });
  }
  return undefined;
}

/**
 * Le gabarit de la route (`/companies/:id`), jamais l'URL appelee : celle-ci
 * porte des identifiants et, sur un retour de connexion, un code (S-03).
 * `req.route` est type `any` par Express.
 */
function cheminDeRoute(req: { route?: unknown; baseUrl: string }): string {
  const chemin = (req.route as { path?: unknown } | undefined)?.path;
  return typeof chemin === 'string' ? `${req.baseUrl}${chemin}` : req.baseUrl;
}

/**
 * Dernier maillon de la chaine. Une erreur inattendue ne sort jamais telle
 * quelle : son message peut contenir une chaine de connexion, un jeton ou une
 * adresse (S-03). Elle est journalisee en entier, et rendue en « erreur
 * interne » accompagnee de l'identifiant de requete, seul lien entre ce que
 * voit l'utilisateur et ce que voit l'exploitant.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const requestId = typeof req.id === 'string' ? req.id : undefined;
  // La session n'est pas montee sur les routes de l'API publique.
  const userId: string | undefined = req.session?.userId;

  const appError =
    error instanceof AppError
      ? error
      : (erreurDeCorps(error) ??
        new AppError({
          status: 500,
          code: 'internal_error',
          title: 'Erreur interne',
          detail: "La requete n'a pas pu aboutir. L'incident a ete enregistre.",
        }));

  if (appError.status >= 500) {
    req.log.error({ err: error }, 'requete en echec');
    // Seules les pannes partent chez Sentry : un refus a 400 est un usage
    // normal de l'API, pas une incidence.
    reportError(error, {
      service: 'api',
      ...(requestId === undefined ? {} : { requestId }),
      ...(userId === undefined ? {} : { userId }),
      method: req.method,
      // Le chemin du routeur, jamais l'URL : elle porte la chaine de requete.
      path: cheminDeRoute(req),
    });
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
