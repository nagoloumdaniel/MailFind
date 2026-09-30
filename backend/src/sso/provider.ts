import { Router } from 'express';
import { z } from 'zod';
import { recordAuditEvent } from '../audit/repository.js';
import { AppError } from '../http/problem.js';
import { findUserById } from '../users/repository.js';
import { consumeSsoCode, issueSsoCode } from './codes.js';
import { PENDING_COOKIE, secretMatches, ssoConfig, STATE_PATTERN } from './shared.js';

/** Dix minutes pour se connecter a MailFind avant de revenir a Campaign Mailer. */
const PENDING_MAX_AGE_MS = 10 * 60 * 1000;

const tokenBodySchema = z.object({ code: z.string().max(200) });

const desactivee = () => AppError.notFound("La connexion croisee n'est pas configuree.");

/**
 * L'echange du code, de serveur a serveur (D-26). Monte avant la session et le
 * jeton CSRF : Campaign Mailer n'a ni cookie ni formulaire, seulement le
 * secret partage.
 */
export function createSsoTokenRouter(): Router {
  const router = Router();

  router.post('/token', (req, res, next) => {
    void (async () => {
      try {
        const config = ssoConfig();
        if (config === undefined) throw desactivee();

        const entete = req.get('authorization') ?? '';
        const fourni = entete.startsWith('Bearer ') ? entete.slice(7) : '';
        if (!secretMatches(fourni, config.secret)) {
          throw new AppError({ status: 401, code: 'invalid_client', title: 'Secret refuse' });
        }

        const corps = tokenBodySchema.safeParse(req.body);
        const user = corps.success ? await consumeSsoCode(corps.data.code) : undefined;
        if (user === undefined) {
          // Code inconnu, deja servi ou perime : une seule reponse pour les
          // trois, rien a apprendre en les distinguant.
          throw AppError.badRequest('invalid_grant', 'Code refuse');
        }

        res.set('cache-control', 'no-store');
        res.json({ google_id: user.googleId, email: user.email, name: user.name });
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}

/**
 * La demande de Campaign Mailer, dans le navigateur (D-26). La personne doit
 * etre connectee a MailFind ; sinon elle passe par Google, puis revient ici.
 * La redirection ne va jamais que vers l'adresse configuree de Campaign
 * Mailer : aucune adresse de retour n'est lue dans la requete.
 */
export function createSsoAuthorizeRouter(): Router {
  const router = Router();

  router.get('/authorize', (req, res, next) => {
    void (async () => {
      try {
        const config = ssoConfig();
        if (config === undefined) throw desactivee();

        const state = req.query.state;
        if (typeof state !== 'string' || !STATE_PATTERN.test(state)) {
          throw AppError.badRequest('invalid_state', 'Demande de connexion invalide');
        }

        const userId = req.session.userId;
        const user = userId === undefined ? undefined : await findUserById(userId);
        if (user === undefined) {
          res.cookie(PENDING_COOKIE, state, {
            httpOnly: true,
            secure: req.secure,
            sameSite: 'lax',
            maxAge: PENDING_MAX_AGE_MS,
            path: '/api',
          });
          res.redirect('/api/auth/google');
          return;
        }

        const code = await issueSsoCode(user.id);
        await recordAuditEvent({
          userId: user.id,
          action: 'sso.authorized',
          entity: 'user',
          entityId: user.id,
          metadata: { partner: 'campaign_mailer' },
        });

        const retour = new URL(`${config.partnerUrl}/api/auth/mailfind/callback`);
        retour.searchParams.set('code', code);
        retour.searchParams.set('state', state);
        res.redirect(retour.toString());
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
