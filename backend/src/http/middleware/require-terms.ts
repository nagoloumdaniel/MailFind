import type { RequestHandler } from 'express';
import { CURRENT_TERMS_VERSION } from '../../auth/routes.js';
import { AppError } from '../problem.js';
import { unauthenticated } from './require-auth.js';

/**
 * Barriere posee devant tout ce qui traite des donnees (F-102). Se connecter
 * ne suffit pas : tant que les conditions en vigueur ne sont pas acceptees,
 * aucun import, aucune collecte, aucun export.
 *
 * A monter apres requireAuth, qui a deja charge le compte.
 */
export const requireAcceptedTerms: RequestHandler = (req, _res, next) => {
  const user = req.currentUser;
  if (user === undefined) {
    next(unauthenticated());
    return;
  }

  if (user.termsVersion !== CURRENT_TERMS_VERSION) {
    next(
      new AppError({
        status: 403,
        code: 'terms_not_accepted',
        title: 'Conditions a accepter',
        detail: "Acceptez les conditions d'utilisation pour continuer.",
      }),
    );
    return;
  }

  next();
};
