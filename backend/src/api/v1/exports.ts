import type { Router } from 'express';
import { z } from 'zod';
import { requireScope } from '../../api-keys/authenticate.js';
import { recordAuditEvent } from '../../audit/repository.js';
import { EXPORT_FORMATS, STATUS_FILTERS, type ExportRequest } from '../../exports/request.js';
import {
  createExport,
  downloadExport,
  findExport,
  type ExportRecord,
} from '../../exports/service.js';
import type { ExportStorage } from '../../exports/storage.js';
import { withUser } from '../../http/handler.js';
import { AppError } from '../../http/problem.js';
import { pathId } from './params.js';

const ids = z.array(z.uuid()).min(1).max(10_000);

export const exportCreationSchema = z
  .object({
    format: z.enum(EXPORT_FORMATS),
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
    best_only: z.boolean().default(false),
    separator: z.enum([',', ';']).default(';'),
  })
  .strict();

function versDemande(corps: z.infer<typeof exportCreationSchema>): ExportRequest {
  const s = corps.scope;
  const scope: ExportRequest['scope'] =
    s.kind === 'import'
      ? { kind: 'import', importId: s.import_id }
      : s.kind === 'emails'
        ? { kind: 'contacts', ids: s.ids }
        : s;
  return {
    format: corps.format,
    scope,
    statuses: corps.statuses,
    bestOnly: corps.best_only,
    separator: corps.separator,
  };
}

function serializeExport(e: ExportRecord) {
  return {
    id: e.id,
    format: e.format,
    status: e.status,
    row_count: e.rowCount,
    filename: e.filename,
    error: e.error,
    created_at: e.createdAt,
    completed_at: e.completedAt,
    expires_at: e.expiresAt,
    // Le lien vaut jusqu'a expires_at, avec la meme cle : jamais d'URL
    // signee publique vers le stockage.
    download_url: e.downloadable ? `/v1/exports/${e.id}/download` : null,
  };
}

/**
 * Exports de l'API (6.11, 6.13). Toujours produits en tache et gardes sept
 * jours : un programme demande, puis vient chercher le fichier quand
 * `status` vaut `done`.
 */
export function registerExports(
  router: Router,
  deps: {
    readonly storage: () => ExportStorage | undefined;
    readonly enqueue: (exportId: string, userId: string) => Promise<void>;
  },
): void {
  router.post(
    '/exports',
    requireScope('exports:write'),
    withUser(async (req, res, user) => {
      const lu = exportCreationSchema.safeParse(req.body);
      if (!lu.success) {
        throw AppError.badRequest(
          'invalid_export',
          'Export refuse',
          `Formats : ${EXPORT_FORMATS.join(', ')} ; perimetres : library, import, tag, companies, emails.`,
        );
      }
      const demande = versDemande(lu.data);
      const issue = await createExport(
        { storage: deps.storage(), enqueue: deps.enqueue },
        user.id,
        demande,
        { alwaysStore: true },
      );
      if (issue.kind !== 'queued') throw new Error("Un export de l'API part toujours en tache.");
      await recordAuditEvent({
        userId: user.id,
        action: 'export.created',
        entity: 'export',
        entityId: issue.export.id,
        metadata: { format: demande.format, scope: demande.scope.kind, via: 'api' },
      });
      res.status(202).json({ export: serializeExport(issue.export) });
    }),
  );

  router.get(
    '/exports/:id',
    requireScope('exports:write'),
    withUser(async (req, res, user) => {
      const id = pathId(req.params.id);
      const trouve = id === undefined ? undefined : await findExport(user.id, id);
      if (trouve === undefined) throw AppError.notFound("Cet export n'existe pas.");
      res.json({ export: serializeExport(trouve) });
    }),
  );

  router.get(
    '/exports/:id/download',
    requireScope('exports:write'),
    withUser(async (req, res, user) => {
      const id = pathId(req.params.id);
      const fichier =
        id === undefined ? undefined : await downloadExport(deps.storage(), user.id, id);
      if (fichier === undefined) {
        throw AppError.notFound("Cet export n'existe pas, ou n'est plus disponible.");
      }
      res
        .set({
          'content-type': fichier.contentType,
          'content-disposition': `attachment; filename="${fichier.filename}"`,
          'cache-control': 'no-store',
        })
        .send(fichier.body);
    }),
  );
}
