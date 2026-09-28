import type { Request, RequestHandler, Response } from 'express';
import type { User } from '../users/repository.js';
import { unauthenticated } from './middleware/require-auth.js';

/**
 * Une route asynchrone qui a besoin du compte connecte. Express 5 ne rattrape
 * pas seul une promesse rejetee dans tous les cas ; l'erreur est donc passee
 * a `next` ici, une fois pour toutes les routes qui l'utilisent.
 */
export function withUser(
  handler: (req: Request, res: Response, user: User) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    const user = req.currentUser;
    if (user === undefined) {
      next(unauthenticated());
      return;
    }
    handler(req, res, user).catch(next);
  };
}
