import { Router } from 'express';
import { z } from 'zod';
import { recordAuditEvent } from '../audit/repository.js';
import { requireAuth, unauthenticated } from '../http/middleware/require-auth.js';
import { requireAcceptedTerms } from '../http/middleware/require-terms.js';
import { AppError } from '../http/problem.js';
import {
  addSuppressions,
  countSuppressions,
  isSuppressed,
  loadSuppressedHashes,
  removeSuppression,
} from './repository.js';

/** Au-dela, l'ajout se fait en plusieurs fois : une requete reste raisonnable. */
const MAX_ADRESSES = 1000;

const ajoutSchema = z.object({
  addresses: z.array(z.string().max(320)).min(1).max(MAX_ADRESSES),
  reason: z.string().max(200).optional(),
});

const adresseSchema = z.object({ address: z.string().min(1).max(320) });

export function createSuppressionsRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireAcceptedTerms);

  router.get('/', (req, res, next) => {
    void (async () => {
      try {
        const user = req.currentUser;
        if (user === undefined) {
          next(unauthenticated());
          return;
        }
        // Un nombre, pas une liste : les adresses ne sont pas gardees.
        res.json({ count: await countSuppressions(user.id) });
      } catch (error) {
        next(error);
      }
    })();
  });

  router.post('/', (req, res, next) => {
    void (async () => {
      try {
        const user = req.currentUser;
        if (user === undefined) {
          next(unauthenticated());
          return;
        }
        const lu = ajoutSchema.safeParse(req.body);
        if (!lu.success) {
          next(
            AppError.badRequest(
              'invalid_suppressions',
              'Liste refusee',
              `Entre 1 et ${String(MAX_ADRESSES)} adresses par ajout.`,
            ),
          );
          return;
        }
        const resultat = await addSuppressions(user.id, lu.data.addresses, lu.data.reason);
        await recordAuditEvent({
          userId: user.id,
          action: 'suppression.added',
          entity: 'suppression',
          entityId: null,
          // Des compteurs, jamais d'adresse (S-03).
          metadata: { added: resultat.added, libraryUpdated: resultat.libraryUpdated },
        });
        res.status(201).json(resultat);
      } catch (error) {
        next(error);
      }
    })();
  });

  router.post('/check', (req, res, next) => {
    void (async () => {
      try {
        const user = req.currentUser;
        if (user === undefined) {
          next(unauthenticated());
          return;
        }
        const lu = adresseSchema.safeParse(req.body);
        if (!lu.success) {
          next(AppError.badRequest('invalid_address', 'Adresse refusee', 'Adresse manquante.'));
          return;
        }
        const empreintes = await loadSuppressedHashes(user.id);
        res.json({ suppressed: isSuppressed(empreintes, lu.data.address) });
      } catch (error) {
        next(error);
      }
    })();
  });

  router.post('/remove', (req, res, next) => {
    void (async () => {
      try {
        const user = req.currentUser;
        if (user === undefined) {
          next(unauthenticated());
          return;
        }
        const lu = adresseSchema.safeParse(req.body);
        if (!lu.success) {
          next(AppError.badRequest('invalid_address', 'Adresse refusee', 'Adresse manquante.'));
          return;
        }
        const retiree = await removeSuppression(user.id, lu.data.address);
        if (retiree) {
          await recordAuditEvent({
            userId: user.id,
            action: 'suppression.removed',
            entity: 'suppression',
            entityId: null,
          });
        }
        res.json({ removed: retiree });
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
