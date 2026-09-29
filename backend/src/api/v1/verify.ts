import type { Router } from 'express';
import { z } from 'zod';
import { requireScope } from '../../api-keys/authenticate.js';
import { withUser } from '../../http/handler.js';
import { AppError } from '../../http/problem.js';
import { enqueueVerificationRun } from '../../queue/queues.js';
import { isSuppressed, loadSuppressedHashes } from '../../suppressions/repository.js';
import { createDisposableCache, isDisposableIn } from '../../verification/disposable.js';
import { createMailDns, type MailDns } from '../../verification/local.js';
import { checkAddressList } from '../../verification/one-off.js';
import {
  createVerificationRun,
  DIRECT_MAX,
  findVerificationRun,
  RUN_MAX,
  type VerificationRun,
} from '../../verification/runs.js';
import { pathId } from './params.js';

const listeSchema = z
  .object({ addresses: z.array(z.string().max(320)).min(1).max(RUN_MAX) })
  .strict();

function serializeRun(run: VerificationRun) {
  return {
    id: run.id,
    status: run.status,
    total: run.total,
    error: run.error,
    created_at: run.createdAt,
    completed_at: run.completedAt,
  };
}

/**
 * Verification d'une liste (6.13, F-1211 pour Campaign Mailer) : les
 * controles gratuits de la verification ponctuelle (F-705), sans rien
 * enregistrer dans la bibliotheque. Jusqu'a 100 adresses la reponse est
 * immediate ; au-dela, jusqu'a 10 000, le travail part en tache et
 * `GET /v1/verifications/{id}` en rend le resultat.
 *
 * `unverified` dit que les controles locaux sont passes, jamais que la boite
 * existe : ce n'est pas un verdict « valide ».
 */
export function registerVerify(router: Router, options: { dns?: MailDns } = {}): void {
  let dns = options.dns;
  const jetables = createDisposableCache();

  router.post(
    '/verify',
    requireScope('verify'),
    withUser(async (req, res, user) => {
      const lu = listeSchema.safeParse(req.body);
      if (!lu.success) {
        throw AppError.badRequest(
          'invalid_address_list',
          'Liste refusee',
          `Entre 1 et ${String(RUN_MAX)} adresses.`,
        );
      }
      const { addresses } = lu.data;
      if (addresses.length > DIRECT_MAX) {
        const run = await createVerificationRun(user.id, addresses);
        await enqueueVerificationRun(run.id);
        res.status(202).json({ verification: serializeRun(run) });
        return;
      }
      const supprimees = await loadSuppressedHashes(user.id);
      const domaines = await jetables();
      const results = await checkAddressList(addresses, {
        dns: (dns ??= createMailDns()),
        isDisposable: (domaine) => isDisposableIn(domaines, domaine),
        isSuppressed: (adresse) => isSuppressed(supprimees, adresse),
      });
      res.json({ results });
    }),
  );

  router.get(
    '/verifications/:id',
    requireScope('verify'),
    withUser(async (req, res, user) => {
      const id = pathId(req.params.id);
      const run = id === undefined ? undefined : await findVerificationRun(user.id, id);
      if (run === undefined) {
        throw AppError.notFound("Cette verification n'existe pas, ou n'est plus gardee.");
      }
      res.json({ verification: serializeRun(run), results: run.results });
    }),
  );
}
