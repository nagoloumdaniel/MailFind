import type { Router } from 'express';
import { z } from 'zod';
import { requireScope } from '../../api-keys/authenticate.js';
import { recordAuditEvent } from '../../audit/repository.js';
import { query } from '../../db/pool.js';
import { withUser } from '../../http/handler.js';
import { AppError } from '../../http/problem.js';
import type { Cipher } from '../../security/crypto.js';
import {
  createWebhook,
  deleteWebhook,
  DELIVERY_COLUMNS,
  listWebhooks,
  ownsWebhook,
  WEBHOOK_EVENTS,
  type DeliveryRecord,
} from '../../webhooks/service.js';
import { cursorCondition, cursorOrder, parsePageParams, toPage } from '../pagination.js';
import { pathId } from './params.js';

export const webhookCreationSchema = z
  .object({
    url: z
      .url({ protocol: /^https$/ })
      .max(2000)
      .describe('https, sur une adresse publique.'),
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
    description: z.string().trim().max(200).optional(),
  })
  .strict();

/**
 * Abonnements aux webhooks (F-1308), sous la portee `integrations:write` :
 * un webhook fait sortir des donnees du compte vers une autre application.
 * Le secret de signature n'est montre qu'a la creation ; la route est exclue
 * de l'idempotence pour ne jamais le garder en clair.
 */
export function registerWebhooks(router: Router, cipher: () => Cipher | undefined): void {
  router.get(
    '/webhooks',
    requireScope('integrations:write'),
    withUser(async (_req, res, user) => {
      res.json({ webhooks: await listWebhooks(user.id) });
    }),
  );

  router.post(
    '/webhooks',
    requireScope('integrations:write'),
    withUser(async (req, res, user) => {
      const lu = webhookCreationSchema.safeParse(req.body);
      if (!lu.success) {
        throw AppError.badRequest(
          'invalid_webhook',
          'Abonnement refuse',
          `Une URL https et au moins un evenement parmi : ${WEBHOOK_EVENTS.join(', ')}.`,
        );
      }
      const { webhook, secret } = await createWebhook(user.id, lu.data, cipher());
      await recordAuditEvent({
        userId: user.id,
        action: 'webhook.created',
        entity: 'webhook',
        entityId: webhook.id,
        metadata: { events: webhook.events, host: new URL(webhook.url).hostname },
      });
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json({ webhook, secret });
    }),
  );

  router.delete(
    '/webhooks/:id',
    requireScope('integrations:write'),
    withUser(async (req, res, user) => {
      const id = pathId(req.params.id);
      if (id === undefined || !(await deleteWebhook(user.id, id))) {
        throw AppError.notFound("Cet abonnement n'existe pas.");
      }
      await recordAuditEvent({
        userId: user.id,
        action: 'webhook.deleted',
        entity: 'webhook',
        entityId: id,
      });
      res.json({ deleted: true });
    }),
  );

  /** Le journal des livraisons d'un abonnement, les plus recentes d'abord. */
  router.get(
    '/webhooks/:id/deliveries',
    requireScope('integrations:write'),
    withUser(async (req, res, user) => {
      const id = pathId(req.params.id);
      if (id === undefined || !(await ownsWebhook(user.id, id))) {
        throw AppError.notFound("Cet abonnement n'existe pas.");
      }
      const { limit, cursor } = parsePageParams(req.query);
      const lignes = await query<DeliveryRecord>(
        `select ${DELIVERY_COLUMNS}
           from webhook_deliveries d
          where d.webhook_id = $1 and ${cursorCondition('d', 2, 3)}
          order by ${cursorOrder('d')}
          limit $4`,
        [id, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
      );
      res.json(toPage(lignes.rows, limit, (d) => ({ createdAt: d.created_at, id: d.id })));
    }),
  );
}
