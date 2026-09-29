import { Router } from 'express';
import { recordAuditEvent } from '../audit/repository.js';
import { withUser } from '../http/handler.js';
import { requireAuth } from '../http/middleware/require-auth.js';
import { requireAcceptedTerms } from '../http/middleware/require-terms.js';
import { AppError } from '../http/problem.js';
import { exportRequestSchema } from './request.js';
import { createExport, downloadExport, listExports } from './service.js';
import type { ExportStorage } from './storage.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un nom de fichier sur pour l'en-tete : ASCII, sans guillemet ni retour a la ligne. */
function disposition(nom: string): string {
  return `attachment; filename="${nom.replace(/[^\w.-]/g, '_')}"`;
}

export function createExportsRouter(options: {
  storage: () => ExportStorage | undefined;
  enqueue: (exportId: string, userId: string) => Promise<void>;
}): Router {
  const router = Router();
  router.use(requireAuth, requireAcceptedTerms);

  router.post(
    '/',
    withUser(async (req, res, user) => {
      const lu = exportRequestSchema.safeParse(req.body);
      if (!lu.success) {
        throw AppError.badRequest(
          'invalid_export',
          'Export refuse',
          'Format, perimetre ou filtre non reconnu.',
        );
      }
      const issue = await createExport(
        { storage: options.storage(), enqueue: options.enqueue },
        user.id,
        lu.data,
      );
      // F-1106 : qui, quand, quel filtre, combien de lignes. Jamais d'adresse.
      await recordAuditEvent({
        userId: user.id,
        action: 'export.created',
        entity: 'export',
        entityId: issue.kind === 'ready' ? issue.exportId : issue.export.id,
        metadata: {
          format: lu.data.format,
          scope: lu.data.scope.kind,
          statuses: lu.data.statuses,
          bestOnly: lu.data.bestOnly,
          ...(issue.kind === 'ready'
            ? { rows: issue.file.rows, skipped: issue.file.skipped }
            : { queued: true }),
        },
      });
      if (issue.kind === 'queued') {
        res.status(202).json({ export: issue.export });
        return;
      }
      res
        .status(200)
        .set({
          'content-type': issue.file.contentType,
          'content-disposition': disposition(issue.file.filename),
          'x-export-id': issue.exportId,
          'x-export-rows': String(issue.file.rows),
          'x-export-skipped': String(issue.file.skipped),
          'cache-control': 'no-store',
        })
        .send(issue.file.body);
    }),
  );

  router.get(
    '/',
    withUser(async (_req, res, user) => {
      res.json({ exports: await listExports(user.id) });
    }),
  );

  router.get(
    '/:id/download',
    withUser(async (req, res, user) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const fichier = UUID.test(id)
        ? await downloadExport(options.storage(), user.id, id)
        : undefined;
      if (fichier === undefined) {
        throw AppError.notFound("Cet export n'existe pas, ou n'est plus disponible.");
      }
      res
        .set({
          'content-type': fichier.contentType,
          'content-disposition': disposition(fichier.filename),
          'cache-control': 'no-store',
        })
        .send(fichier.body);
    }),
  );

  return router;
}
