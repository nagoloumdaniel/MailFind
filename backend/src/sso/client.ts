import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { recordAuditEvent } from '../audit/repository.js';
import { regenerate, save } from '../auth/routes.js';
import { getEnvironment } from '../config/env.js';
import { signInWithGoogle } from '../users/repository.js';
import {
  createSsoExchange,
  secretMatches,
  ssoConfig,
  STATE_PATTERN,
  type SsoExchange,
} from './shared.js';

export interface CampaignMailerSignInOptions {
  /** L'echange du code ; les tests y mettent un faux Campaign Mailer. */
  readonly exchange?: SsoExchange;
}

/** Violation d'unicite PostgreSQL : l'adresse appartient a un autre compte Google. */
const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';

/**
 * « Se connecter avec Campaign Mailer » (D-26). Campaign Mailer confirme
 * l'identite Google de la personne ; MailFind retrouve le compte par cet
 * identifiant, le meme que celui d'une connexion Google directe, et n'en cree
 * un que s'il n'existe pas. Une adresse deja prise par un autre compte Google
 * est refusee plutot que rattachee.
 */
export function createCampaignMailerSignInRouter(
  options: CampaignMailerSignInOptions = {},
): Router {
  const router = Router();
  const environment = getEnvironment();
  const erreur = (code: string) => `${environment.APP_URL}/connexion?erreur=${code}`;

  router.get('/', (req, res, next) => {
    void (async () => {
      try {
        const config = ssoConfig();
        if (config === undefined) {
          res.redirect(erreur('indisponible'));
          return;
        }
        const state = randomBytes(32).toString('base64url');
        req.session.ssoState = state;
        await save(req.session);

        const demande = new URL(`${config.partnerUrl}/api/sso/authorize`);
        demande.searchParams.set('state', state);
        res.redirect(demande.toString());
      } catch (error) {
        next(error);
      }
    })();
  });

  router.get('/callback', (req, res) => {
    void (async () => {
      try {
        const config = ssoConfig();
        const attendu = req.session.ssoState;
        delete req.session.ssoState;
        const { code, state } = req.query;

        // Le jeton d'etat relie ce retour au navigateur qui a commence la
        // connexion : sans lui, un tiers ferait ouvrir sa propre session ici.
        if (
          config === undefined ||
          attendu === undefined ||
          typeof state !== 'string' ||
          !STATE_PATTERN.test(state) ||
          !secretMatches(state, attendu) ||
          typeof code !== 'string'
        ) {
          res.redirect(erreur('refus'));
          return;
        }

        const exchange = options.exchange ?? createSsoExchange(config);
        const identite = await exchange(code);

        let result;
        try {
          result = await signInWithGoogle({
            googleId: identite.google_id,
            email: identite.email,
            name: identite.name ?? null,
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            res.redirect(erreur('conflit'));
            return;
          }
          throw error;
        }

        await regenerate(req.session);
        req.session.userId = result.user.id;
        await save(req.session);

        await recordAuditEvent({
          userId: result.user.id,
          action: result.created ? 'user.signed_up' : 'user.signed_in',
          entity: 'user',
          entityId: result.user.id,
          metadata: { via: 'campaign_mailer' },
        });

        res.redirect(environment.APP_URL);
      } catch (failure) {
        req.log.error({ err: failure }, 'echec de la connexion par Campaign Mailer');
        res.redirect(erreur('technique'));
      }
    })();
  });

  return router;
}
