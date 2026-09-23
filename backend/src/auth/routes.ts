import { Router, type RequestHandler } from 'express';
import passport from 'passport';
import { recordAuditEvent } from '../audit/repository.js';
import { getEnvironment } from '../config/env.js';
import { loadCurrentUser } from '../http/middleware/require-auth.js';
import { AppError } from '../http/problem.js';
import type { SignInResult, User } from '../users/repository.js';
import { configureGoogleStrategy } from './google.js';
import { toError } from '../errors.js';

export const CURRENT_TERMS_VERSION = '2026-09-23';

export function publicUser(user: User): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    termsVersion: user.termsVersion,
    // L'interface a besoin de savoir s'il faut afficher l'acceptation des
    // conditions avant toute autre chose (F-102).
    termsAccepted: user.termsVersion === CURRENT_TERMS_VERSION,
  };
}

/** Regenere l'identifiant de session a la connexion, contre la fixation. */
async function regenerate(session: Express.Request['session']): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    session.regenerate((error) => {
      if (error) reject(toError(error, 'Operation de session en echec.'));
      else resolve();
    });
  });
}

async function save(session: Express.Request['session']): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    session.save((error) => {
      if (error) reject(toError(error, 'Operation de session en echec.'));
      else resolve();
    });
  });
}

type GoogleCallback = (error: unknown, result: SignInResult | false | undefined) => void;

/**
 * `passport.authenticate` est type `any` par la bibliotheque. Le ramener a un
 * RequestHandler une seule fois evite de desactiver les regles de typage a
 * chaque appel.
 */
function authenticateGoogle(callback?: GoogleCallback): RequestHandler {
  return passport.authenticate('google', { session: false }, callback) as RequestHandler;
}

export function createAuthRouter(): Router {
  configureGoogleStrategy();
  const environment = getEnvironment();
  const router = Router();

  // `session: false` : passport ne gere pas la session, MailFind la gere.
  // L'option `state` de la strategie utilise quand meme express-session, qui
  // est monte en amont.
  router.get('/google', authenticateGoogle());

  router.get('/google/callback', (req, res, next) => {
    const handler = authenticateGoogle(
      (error: unknown, result: SignInResult | false | undefined) => {
        void (async () => {
          try {
            if (error !== null && error !== undefined) {
              throw toError(error, "Google a refuse l'authentification.");
            }
            if (result === false || result === undefined) {
              // Refus cote Google, ou jeton d'etat invalide. Rien a detailler
              // a l'utilisateur : il recommence.
              res.redirect(`${environment.APP_URL}/connexion?erreur=refus`);
              return;
            }

            await regenerate(req.session);
            req.session.userId = result.user.id;
            await save(req.session);

            await recordAuditEvent({
              userId: result.user.id,
              action: result.created ? 'user.signed_up' : 'user.signed_in',
              entity: 'user',
              entityId: result.user.id,
            });

            res.redirect(environment.APP_URL);
          } catch (failure) {
            req.log.error({ err: failure }, 'echec de la connexion Google');
            res.redirect(`${environment.APP_URL}/connexion?erreur=technique`);
          }
        })();
      },
    );

    handler(req, res, next);
  });

  router.get('/me', (req, res, next) => {
    void (async () => {
      try {
        const user = await loadCurrentUser(req);
        if (user === undefined) {
          // 200 avec `user: null` et non 401 : savoir que personne n'est
          // connecte est une reponse normale pour l'application, pas une
          // erreur.
          res.json({ user: null });
          return;
        }
        res.json({ user: publicUser(user) });
      } catch (error) {
        next(error);
      }
    })();
  });

  router.post('/logout', (req, res, next) => {
    void (async () => {
      const userId = req.session.userId;
      try {
        if (userId !== undefined) {
          await recordAuditEvent({
            userId,
            action: 'user.signed_out',
            entity: 'user',
            entityId: userId,
          });
        }

        await new Promise<void>((resolve, reject) => {
          req.session.destroy((error) => {
            if (error) reject(toError(error, 'Operation de session en echec.'));
            else resolve();
          });
        });

        res.clearCookie('mailfind.sid');
        res.status(204).end();
      } catch (error) {
        next(
          error instanceof AppError
            ? error
            : new AppError({
                status: 500,
                code: 'logout_failed',
                title: 'Deconnexion impossible',
              }),
        );
      }
    })();
  });

  return router;
}
