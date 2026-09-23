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
          // Les entreprises, adresses et sources arrivent avec les phases qui
          // les creent. Les declarer vides ici plutot que de les taire evite un
          // export qui aurait l'air complet sans l'etre.
          companies: [],
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
