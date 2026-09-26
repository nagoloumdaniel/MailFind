import { Router } from 'express';
import { recordAuditEvent } from '../audit/repository.js';
import { query } from '../db/pool.js';
import { requireAuth, unauthenticated } from '../http/middleware/require-auth.js';
import { AppError } from '../http/problem.js';
import { toError } from '../errors.js';

/**
 * Page Compte (F-104) : ce que MailFind sait de vous, et les deux sorties.
 *
 * L'export et la suppression ne sont pas des options de confort. Ils sont la
 * reversibilite exigee par le cahier des charges et le droit d'effacement
 * (R-05), et ils doivent marcher des le premier jour, pas etre ajoutes quand
 * quelqu'un les reclamera.
 */
export function createAccountRouter(): Router {
  const router = Router();

  router.get('/export', requireAuth, (req, res, next) => {
    void (async () => {
      try {
        const user = req.currentUser;
        if (user === undefined) {
          next(unauthenticated());
          return;
        }

        const events = await query<{
          action: string;
          entity: string;
          entity_id: string | null;
          metadata: unknown;
          created_at: Date;
        }>(
          `select action, entity, entity_id, metadata, created_at
             from audit_events
            where user_id = $1
            order by created_at`,
          [user.id],
        );

        // Tout ce qu'un import a laisse : le fichier tel qu'il a ete lu, ligne
        // par ligne, et les entreprises qui en sont sorties. Sans cela,
        // l'export annoncerait une bibliotheque vide a quelqu'un qui en a une.
        const imports = await query<{
          id: string;
          filename: string;
          status: string;
          settings: unknown;
          total_rows: number;
          processed_rows: number;
          error: string | null;
          created_at: Date;
          completed_at: Date | null;
        }>(
          `select id, filename, status::text as status, settings, total_rows, processed_rows,
                  error, created_at, completed_at
             from imports
            where user_id = $1
            order by created_at`,
          [user.id],
        );

        const lignes = await query<{
          import_id: string;
          line: number;
          raw: unknown;
          status: string;
          error: string | null;
          company_id: string | null;
        }>(
          `select r.import_id, r.line, r.raw, r.status::text as status, r.error, r.company_id
             from import_rows r
             join imports i on i.id = r.import_id
            where i.user_id = $1
            order by r.import_id, r.line`,
          [user.id],
        );

        const companies = await query(
          `select id, name, legal_name, domain, domain_status::text as domain_status,
                  domain_confidence, website_url, careers_url, siren, city, country, industry,
                  employee_range, linkedin_url, phone, contact_form_url,
                  crawl_status::text as crawl_status, tags, notes, attributes,
                  last_enriched_at, created_at, updated_at
             from companies
            where user_id = $1
            order by created_at`,
          [user.id],
        );

        const lignesParImport = new Map<string, object[]>();
        for (const ligne of lignes.rows) {
          const liste = lignesParImport.get(ligne.import_id) ?? [];
          liste.push({
            line: ligne.line,
            raw: ligne.raw,
            status: ligne.status,
            error: ligne.error,
            companyId: ligne.company_id,
          });
          lignesParImport.set(ligne.import_id, liste);
        }

        await recordAuditEvent({
          userId: user.id,
          action: 'user.exported_data',
          entity: 'user',
          entityId: user.id,
        });

        // Telechargement et non affichage : ce fichier est fait pour etre
        // garde, relu ailleurs, ou remis a quelqu'un.
        res.setHeader('content-disposition', 'attachment; filename="mailfind-donnees.json"');
        res.json({
          exportedAt: new Date().toISOString(),
          format: 'mailfind.export.v1',
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            termsVersion: user.termsVersion,
            termsAcceptedAt: user.termsAcceptedAt,
            createdAt: user.createdAt,
          },
          auditEvents: events.rows,
          imports: imports.rows.map((importe) => ({
            id: importe.id,
            filename: importe.filename,
            status: importe.status,
            settings: importe.settings,
            totalRows: importe.total_rows,
            processedRows: importe.processed_rows,
            error: importe.error,
            createdAt: importe.created_at,
            completedAt: importe.completed_at,
            rows: lignesParImport.get(importe.id) ?? [],
          })),
          companies: companies.rows,
          // Les adresses et leurs sources arrivent avec les phases qui les
          // creent. Les declarer vides ici plutot que de les taire evite un
          // export qui aurait l'air complet sans l'etre.
          emails: [],
          emailSources: [],
        });
      } catch (error) {
        next(error);
      }
    })();
  });

  router.delete('/', requireAuth, (req, res, next) => {
    void (async () => {
      try {
        const user = req.currentUser;
        if (user === undefined) {
          next(unauthenticated());
          return;
        }

        // L'evenement d'audit est ecrit avant la suppression, tant que le
        // compte existe encore. La cle etrangere le mettra ensuite a nul : la
        // trace de l'effacement survit, sans designer personne.
        await recordAuditEvent({
          userId: user.id,
          action: 'user.deleted',
          entity: 'user',
          entityId: user.id,
        });

        // Suppression definitive, pas un drapeau (R-05).
        await query('delete from users where id = $1', [user.id]);

        await new Promise<void>((resolve, reject) => {
          req.session.destroy((error) => {
            if (error) reject(toError(error, 'La session n a pas pu etre fermee.'));
            else resolve();
          });
        });

        res.clearCookie('mailfind.sid');
        res.status(204).end();
      } catch (error) {
        next(
          error instanceof AppError
            ? error
            : new AppError({
                status: 500,
                code: 'account_deletion_failed',
                title: 'Suppression impossible',
                detail: "Le compte n'a pas ete supprime. Reessayez.",
              }),
        );
      }
    })();
  });

  return router;
}
