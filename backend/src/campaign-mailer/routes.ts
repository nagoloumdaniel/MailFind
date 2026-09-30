import { Router } from 'express';
import { z } from 'zod';
import { recordAuditEvent } from '../audit/repository.js';
import { withUser } from '../http/handler.js';
import { requireAuth } from '../http/middleware/require-auth.js';
import { requireAcceptedTerms } from '../http/middleware/require-terms.js';
import { AppError } from '../http/problem.js';
import type { Cipher } from '../security/crypto.js';
import { deleteConnection, getConnection, saveConnection } from './connection.js';
import { createPush, findPush, listPushes } from './push.js';
import { exportRequestSchema, STATUS_FILTERS } from '../exports/request.js';

const connexionSchema = z.object({ token: z.string().max(200) }).strict();

export const envoiSchema = z
  .object({
    campaignName: z.string().trim().min(1).max(200),
    scope: exportRequestSchema.shape.scope,
    statuses: z.enum(STATUS_FILTERS).default('valid_accept_all'),
  })
  .strict();

/**
 * La connexion a Campaign Mailer, depuis la page Compte (F-1201). Par session
 * et jeton CSRF seulement : une cle d'API de MailFind ne peut pas changer la
 * connexion d'un compte.
 */
export function createCampaignMailerRouter(options: {
  cipher: () => Cipher | undefined;
  /** La mise en file d'un envoi ; les tests la remplacent. */
  enqueuePush: (pushId: string) => Promise<void>;
}): Router {
  const router = Router();
  router.use(requireAuth, requireAcceptedTerms);

  router.get(
    '/connection',
    withUser(async (_req, res, user) => {
      res.json(await getConnection(user.id));
    }),
  );

  router.put(
    '/connection',
    withUser(async (req, res, user) => {
      const lu = connexionSchema.safeParse(req.body);
      if (!lu.success) {
        throw AppError.badRequest(
          'invalid_campaign_mailer_token',
          'Jeton refuse',
          'Jeton manquant.',
        );
      }
      const connexion = await saveConnection(user.id, lu.data.token, options.cipher());
      await recordAuditEvent({
        userId: user.id,
        action: 'campaign_mailer.connected',
        entity: 'campaign_mailer',
        entityId: null,
        // Le prefixe sert a reconnaitre le jeton, il ne permet pas de s'en servir.
        metadata: { prefix: connexion.tokenPrefix },
      });
      res.json(connexion);
    }),
  );

  router.delete(
    '/connection',
    withUser(async (_req, res, user) => {
      if (await deleteConnection(user.id)) {
        await recordAuditEvent({
          userId: user.id,
          action: 'campaign_mailer.disconnected',
          entity: 'campaign_mailer',
          entityId: null,
        });
      }
      res.json(await getConnection(user.id));
    }),
  );

  /**
   * Envoi d'une selection vers un brouillon de Campaign Mailer (F-1202) : le
   * perimetre d'un export, un filtre de statut, un nom de campagne. Fait par
   * le processus de traitement ; la page suit l'envoi par son identifiant.
   */
  router.post(
    '/pushes',
    withUser(async (req, res, user) => {
      const lu = envoiSchema.safeParse(req.body);
      if (!lu.success) {
        throw AppError.badRequest(
          'invalid_push',
          'Envoi refuse',
          'Un nom de campagne, une selection et un filtre de statut.',
        );
      }
      const envoi = await createPush(user.id, lu.data, options.enqueuePush);
      await recordAuditEvent({
        userId: user.id,
        action: 'campaign_mailer.pushed',
        entity: 'campaign_mailer_push',
        entityId: envoi.id,
        metadata: { scope: lu.data.scope.kind, statuses: lu.data.statuses },
      });
      res.status(202).json({ push: envoi });
    }),
  );

  router.get(
    '/pushes',
    withUser(async (_req, res, user) => {
      res.json({ pushes: await listPushes(user.id) });
    }),
  );

  router.get(
    '/pushes/:id',
    withUser(async (req, res, user) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const envoi = z.uuid().safeParse(id).success ? await findPush(user.id, id) : undefined;
      if (envoi === undefined) throw AppError.notFound("Cet envoi n'existe pas.");
      res.json({ push: envoi });
    }),
  );

  return router;
}
