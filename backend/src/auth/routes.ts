import { Router, type RequestHandler } from 'express';
import passport from 'passport';
import { z } from 'zod';
import { recordAuditEvent } from '../audit/repository.js';
import { getEnvironment } from '../config/env.js';
import { loadCurrentUser, requireAuth, unauthenticated } from '../http/middleware/require-auth.js';
import { AppError } from '../http/problem.js';
import { acceptTerms, type SignInResult, type User } from '../users/repository.js';
import { configureGoogleStrategy } from './google.js';
import { toError } from '../errors.js';

/**
 * Version en vigueur des conditions d'utilisation et de la politique de
 * confidentialite. Datee, pas numerotee : la date dit tout de suite de quel
 * texte on parle. La faire changer redemande l'accord a tout le monde.
 */
export const CURRENT_TERMS_VERSION = '2026-09-23';

const acceptTermsSchema = z.object({ version: z.string().min(1) });

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

  /**
   * Acceptation des conditions et de la politique de confidentialite (F-102).
   *
   * La version acceptee est enregistree, pas un simple « oui » : le jour ou le
   * texte change, il faut pouvoir dire qui a accepte quoi, et redemander
   * l'accord a ceux qui n'ont vu que l'ancien.
   */
  router.post('/terms', requireAuth, (req, res, next) => {
    void (async () => {
      try {
        const parsed = acceptTermsSchema.safeParse(req.body);
        if (!parsed.success) {
          next(
            AppError.badRequest(
              'invalid_body',
              'Requete invalide',
              'La version des conditions est absente.',
            ),
          );
          return;
        }

        if (parsed.data.version !== CURRENT_TERMS_VERSION) {
          // Accepter une version que le serveur ne sert plus reviendrait a
          // enregistrer un accord sur un texte que personne n'a lu.
          next(
            AppError.badRequest(
              'terms_version_unknown',
              'Conditions obsoletes',
              'Rechargez la page pour lire la version en vigueur.',
            ),
          );
          return;
        }

        const user = req.currentUser;
        if (user === undefined) {
          next(unauthenticated());
          return;
        }

        const updated = await acceptTerms(user.id, parsed.data.version);
        if (updated === undefined) {
          next(unauthenticated());
          return;
        }

        await recordAuditEvent({
          userId: updated.id,
          action: 'user.accepted_terms',
          entity: 'user',
          entityId: updated.id,
          metadata: { version: parsed.data.version },
        });

        res.json({ user: publicUser(updated) });
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
