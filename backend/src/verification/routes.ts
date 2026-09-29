import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, unauthenticated } from '../http/middleware/require-auth.js';
import { requireAcceptedTerms } from '../http/middleware/require-terms.js';
import { AppError } from '../http/problem.js';
import { isSuppressed, loadSuppressedHashes } from '../suppressions/repository.js';
import { createDisposableCache, isDisposableIn } from './disposable.js';
import { createMailDns, type MailDns } from './local.js';
import { checkAddressList, ONE_OFF_MAX } from './one-off.js';

const listeSchema = z.object({
  addresses: z.array(z.string().max(320)).min(1).max(ONE_OFF_MAX),
});

/** Verification ponctuelle d'une liste d'adresses (F-705). Rien n'est enregistre. */
export function createVerificationsRouter(options: { dns?: MailDns } = {}): Router {
  const router = Router();
  const dns = options.dns ?? createMailDns();
  const jetables = createDisposableCache();
  router.use(requireAuth, requireAcceptedTerms);

  router.post('/one-off', (req, res, next) => {
    void (async () => {
      try {
        const user = req.currentUser;
        if (user === undefined) {
          next(unauthenticated());
          return;
        }
        const lu = listeSchema.safeParse(req.body);
        if (!lu.success) {
          next(
            AppError.badRequest(
              'invalid_address_list',
              'Liste refusee',
              `Entre 1 et ${String(ONE_OFF_MAX)} adresses par verification.`,
            ),
          );
          return;
        }
        const supprimees = await loadSuppressedHashes(user.id);
        const domaines = await jetables();
        const results = await checkAddressList(lu.data.addresses, {
          dns,
          isDisposable: (domaine) => isDisposableIn(domaines, domaine),
          isSuppressed: (adresse) => isSuppressed(supprimees, adresse),
        });
        res.json({ results });
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
