import { Router } from 'express';
import { z } from 'zod';
import { getEnvironment } from '../config/env.js';
import { AppError } from '../http/problem.js';
import { listExcludedDomains, normalizeDomain, requestExclusion } from './exclusions.js';

/**
 * La page publique de l'agent de collecte (R-07).
 *
 * Ces routes repondent sans session : un webmestre qui veut nous arreter n'a
 * pas de compte chez nous, et lui en demander un reviendrait a ne pas
 * repondre. Elles sont montees avant la session et le jeton CSRF, comme
 * l'API publique, pour la meme raison.
 *
 * La demande n'exige ni nom ni adresse : il n'y a donc rien de personnel a
 * garder, et rien a protéger (S-03).
 */

const DOMAINE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const demandeSchema = z.object({
  domain: z.string().min(3).max(255),
  reason: z.string().max(500).optional(),
});

/** Ce que l'agent dit de lui-meme, la meme chose que son en-tete annonce. */
export function botDescription(): Record<string, unknown> {
  const environment = getEnvironment();
  return {
    user_agent: environment.CRAWLER_USER_AGENT,
    requests_per_second_per_domain: environment.CRAWLER_REQUESTS_PER_SECOND_PER_DOMAIN,
    respects_robots_txt: true,
    follows_redirects: environment.CRAWLER_MAX_REDIRECTS,
    reads: [
      "les pages publiques d'un site : accueil, contact, carrieres, mentions legales, equipe",
    ],
    never: [
      'ne se connecte a aucun espace protege',
      "ne tente pas de decoder une adresse qu'un site a masquee",
      'ne contourne ni CAPTCHA ni limite de debit',
      'ne lit aucune page interdite par robots.txt',
    ],
    opt_out: 'POST /api/bot/exclusion, ou la page /robot de l application',
  };
}

export function createBotRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ bot: botDescription() });
  });

  /**
   * Demande d'exclusion. Appliquee des sa reception : respecter un refus ne
   * doit pas attendre une revue. L'exploitant peut la refuser ensuite.
   */
  router.post('/exclusion', (req, res, next) => {
    void (async () => {
      try {
        const corps = demandeSchema.safeParse(req.body);
        const domaine = corps.success ? normalizeDomain(corps.data.domain) : '';
        if (!corps.success || !DOMAINE.test(domaine)) {
          next(
            AppError.badRequest(
              'invalid_domain',
              'Domaine invalide',
              'Indiquez un domaine, par exemple acme.fr.',
            ),
          );
          return;
        }

        const issue = await requestExclusion(domaine, corps.data.reason);
        res.status(issue === 'recorded' ? 201 : 200).json({
          domain: domaine,
          excluded: true,
          already_known: issue === 'already_known',
          detail:
            "C'est enregistre. Ce domaine et ses sous-domaines ne seront plus explores, pour tous les comptes.",
        });
      } catch (error) {
        next(error);
      }
    })();
  });

  router.get('/exclusions', (_req, res, next) => {
    void (async () => {
      try {
        res.json({ domains: await listExcludedDomains() });
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
