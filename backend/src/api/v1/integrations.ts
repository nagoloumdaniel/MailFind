import type { Router } from 'express';
import { z } from 'zod';
import { requireScope } from '../../api-keys/authenticate.js';
import { recordAuditEvent } from '../../audit/repository.js';
import { createPush, findPush, type PushRecord } from '../../campaign-mailer/push.js';
import { STATUS_FILTERS } from '../../exports/request.js';
import { withUser } from '../../http/handler.js';
import { AppError } from '../../http/problem.js';
import { pathId } from './params.js';

const ids = z.array(z.uuid()).min(1).max(10_000);

export const pushCreationSchema = z
  .object({
    campaign_name: z.string().trim().min(1).max(200),
    scope: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('library') }).strict(),
        z.object({ kind: z.literal('import'), import_id: z.uuid() }).strict(),
        z.object({ kind: z.literal('tag'), tag: z.string().trim().min(1).max(50) }).strict(),
        z.object({ kind: z.literal('companies'), ids }).strict(),
        z.object({ kind: z.literal('emails'), ids }).strict(),
      ])
      .default({ kind: 'library' }),
    statuses: z.enum(STATUS_FILTERS).default('valid_accept_all'),
  })
  .strict();

export function serializePush(p: PushRecord) {
  return {
    id: p.id,
    campaign_name: p.campaignName,
    status: p.status,
    campaign_id: p.campaignId,
    campaign_url: p.campaignUrl,
    batches_total: p.batchesTotal,
    batches_done: p.batchesDone,
    sent: p.sent,
    imported: p.imported,
    rejected: p.rejected,
    skipped: p.skipped,
    error: p.error,
    created_at: p.createdAt,
    completed_at: p.completedAt,
  };
}

/**
 * Envoi d'une selection vers Campaign Mailer par l'API (6.13, F-1202), sous
 * la portee `integrations:write`. Le compte doit avoir connecte Campaign
 * Mailer depuis sa page Compte : une cle de MailFind ne porte pas le jeton
 * de Campaign Mailer, et ne peut pas le changer.
 */
export function registerIntegrations(
  router: Router,
  enqueuePush: (pushId: string) => Promise<void>,
): void {
  router.post(
    '/integrations/campaign-mailer/push',
    requireScope('integrations:write'),
    withUser(async (req, res, user) => {
      const lu = pushCreationSchema.safeParse(req.body);
      if (!lu.success) {
        throw AppError.badRequest(
          'invalid_push',
          'Envoi refuse',
          'campaign_name, un perimetre (library, import, tag, companies, emails) et statuses.',
        );
      }
      const s = lu.data.scope;
      const scope =
        s.kind === 'import'
          ? { kind: 'import' as const, importId: s.import_id }
          : s.kind === 'emails'
            ? { kind: 'contacts' as const, ids: s.ids }
            : s;
      const envoi = await createPush(
        user.id,
        { campaignName: lu.data.campaign_name, scope, statuses: lu.data.statuses },
        enqueuePush,
      );
      await recordAuditEvent({
        userId: user.id,
        action: 'campaign_mailer.pushed',
        entity: 'campaign_mailer_push',
        entityId: envoi.id,
        metadata: { scope: scope.kind, statuses: lu.data.statuses, via: 'api' },
      });
      res.status(202).json({ push: serializePush(envoi) });
    }),
  );

  router.get(
    '/integrations/campaign-mailer/pushes/:id',
    requireScope('integrations:write'),
    withUser(async (req, res, user) => {
      const id = pathId(req.params.id);
      const envoi = id === undefined ? undefined : await findPush(user.id, id);
      if (envoi === undefined) throw AppError.notFound("Cet envoi n'existe pas.");
      res.json({ push: serializePush(envoi) });
    }),
  );
}
