import type { Request, RequestHandler } from 'express';
import { AppError } from '../problem.js';
import { findUserById, type User } from '../../users/repository.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Compte connecte, pose par requireAuth. */
    currentUser?: User;
  }
}

export function unauthenticated(): AppError {
  return new AppError({
    status: 401,
    code: 'unauthenticated',
    title: 'Connexion requise',
    detail: 'Connectez-vous pour acceder a cette ressource.',
  });
}

/**
 * Charge le compte a chaque requete plutot que de recopier ses champs dans la
 * session. Une session ne doit porter que l'identifiant : un compte supprime,
 * ou dont les conditions ont ete acceptees entre-temps, doit etre vu dans son
 * etat reel, pas dans celui qu'il avait a la connexion.
 */
export async function loadCurrentUser(req: Request): Promise<User | undefined> {
  const userId = req.session.userId;
  if (userId === undefined) return undefined;

  const user = await findUserById(userId);
  if (user === undefined) {
    // Le compte a disparu depuis la connexion : la session ne vaut plus rien.
    // `delete` et non `= undefined` : exactOptionalPropertyTypes distingue une
    // propriete absente d'une propriete presente et vide.
    delete req.session.userId;
    return undefined;
  }
  return user;
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  void (async () => {
    try {
      const user = await loadCurrentUser(req);
      if (user === undefined) {
        next(unauthenticated());
        return;
      }
      req.currentUser = user;
      next();
    } catch (error) {
      next(error);
    }
  })();
};
