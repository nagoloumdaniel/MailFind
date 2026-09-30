import { Router } from 'express';
import { z } from 'zod';
import { recordAuditEvent } from '../audit/repository.js';
import { withUser } from '../http/handler.js';
import { requireAuth } from '../http/middleware/require-auth.js';
import { requireAcceptedTerms } from '../http/middleware/require-terms.js';
import { AppError } from '../http/problem.js';
import type { Cipher } from '../security/crypto.js';
import { deleteConnection, getConnection, saveConnection } from './connection.js';

const connexionSchema = z.object({ token: z.string().max(200) }).strict();

/**
 * La connexion a Campaign Mailer, depuis la page Compte (F-1201). Par session
 * et jeton CSRF seulement : une cle d'API de MailFind ne peut pas changer la
 * connexion d'un compte.
 */
export function createCampaignMailerRouter(options: { cipher: () => Cipher | undefined }): Router {
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

  return router;
}
