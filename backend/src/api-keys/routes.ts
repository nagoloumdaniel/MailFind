import { Router } from 'express';
import { z } from 'zod';
import { recordAuditEvent } from '../audit/repository.js';
import { withUser } from '../http/handler.js';
import { requireAuth } from '../http/middleware/require-auth.js';
import { requireAcceptedTerms } from '../http/middleware/require-terms.js';
import { AppError } from '../http/problem.js';
import { API_SCOPES } from './keys.js';
import { createApiKey, listApiKeys, MAX_ACTIVE_KEYS, revokeApiKey } from './repository.js';

const creationSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
});

const idSchema = z.uuid();

/**
 * Cles d'API, gerees depuis la page Compte (F-1302). Ces routes passent par
 * la session et le jeton CSRF, jamais par une cle : une cle ne cree ni ne
 * revoque d'autre cle.
 */
export function createApiKeysRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireAcceptedTerms);

  router.get(
    '/',
    withUser(async (_req, res, user) => {
      res.json({ keys: await listApiKeys(user.id), maxActive: MAX_ACTIVE_KEYS });
    }),
  );

  router.post(
    '/',
    withUser(async (req, res, user) => {
      const lu = creationSchema.safeParse(req.body);
      if (!lu.success) {
        throw AppError.badRequest(
          'invalid_api_key_request',
          'Cle refusee',
          'Donnez un nom de 1 a 100 caracteres et au moins une portee connue.',
        );
      }
      const issue = await createApiKey(user.id, lu.data.name, lu.data.scopes);
      if (issue.kind === 'limit_reached') {
        throw new AppError({
          status: 409,
          code: 'api_key_limit_reached',
          title: 'Trop de cles actives',
          detail: `Revoquez une cle avant d'en creer une autre (${String(MAX_ACTIVE_KEYS)} au plus).`,
        });
      }
      await recordAuditEvent({
        userId: user.id,
        action: 'api_key.created',
        entity: 'api_key',
        entityId: issue.key.id,
        // Le prefixe sert a reconnaitre la cle, il ne permet pas de s'en servir.
        metadata: { prefix: issue.key.prefix, scopes: issue.key.scopes },
      });
      // Le secret ne sera plus jamais rendu : ni cache, ni journal.
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json({ key: issue.key, secret: issue.secret });
    }),
  );

  router.delete(
    '/:id',
    withUser(async (req, res, user) => {
      const id = idSchema.safeParse(req.params.id);
      const revoquee = id.success ? await revokeApiKey(user.id, id.data) : null;
      if (revoquee === null) throw AppError.notFound('Cle introuvable ou deja revoquee.');
      await recordAuditEvent({
        userId: user.id,
        action: 'api_key.revoked',
        entity: 'api_key',
        entityId: revoquee.id,
        metadata: { prefix: revoquee.prefix },
      });
      res.json({ key: revoquee });
    }),
  );

  return router;
}
