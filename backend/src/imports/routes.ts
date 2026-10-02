import express, { Router } from 'express';
import { z } from 'zod';
import { requireAuth, unauthenticated } from '../http/middleware/require-auth.js';
import { requireAcceptedTerms } from '../http/middleware/require-terms.js';
import { AppError } from '../http/problem.js';
import { KNOWN_FIELDS } from './fields.js';
import { importSettingsSchema } from './settings.js';
import { cancelImport } from './plan.js';
import {
  findImport,
  importProgress,
  listImportEmails,
  listImports,
  listRejectedRows,
} from './repository.js';
import { submitImport } from './submit.js';
import { estimateImport } from './estimate.js';
import { resumeBlocked } from '../quotas/resume.js';
import { quotaReport } from '../quotas/usage.js';
import { enqueueCompanyStep } from '../queue/queues.js';
import type { Enqueue } from '../pipeline/start.js';

/** F-201 : 5 000 lignes au plus, la meme limite que celle annoncee a l'ecran. */
const MAX_ROWS = 5000;
const MAX_COLUMNS = 100;

/**
 * Le corps d'un import de 5 000 lignes depasse largement la limite generale
 * d'un megaoctet. Elle n'est relevee que sur cette route : partout ailleurs,
 * un corps volumineux reste suspect.
 */
const BODY_LIMIT = '12mb';

const createSchema = z.object({
  filename: z.string().min(1).max(255),
  headers: z.array(z.string().max(300)).min(1).max(MAX_COLUMNS),
  mapping: z.array(z.union([z.enum(KNOWN_FIELDS), z.null()])).max(MAX_COLUMNS),
  rows: z
    .array(z.array(z.string().max(10_000)).max(MAX_COLUMNS))
    .min(1)
    .max(MAX_ROWS),
  // Absents, les reglages prennent leurs valeurs par defaut : un appel qui ne
  // les envoie pas doit donner le meme import que l'ecran laisse tel quel.
  settings: importSettingsSchema.prefault({}),
  /**
   * F-1402 : l'utilisateur a vu l'estimation et la confirme. Exigee au-dela
   * du seuil, ignoree en dessous.
   */
  confirmedEstimate: z.boolean().default(false),
});

const estimateSchema = z.object({
  rows: z.coerce.number().int().min(1).max(MAX_ROWS),
  settings: importSettingsSchema.prefault({}),
});

export interface ImportsRouterOptions {
  /** La file des etapes ; les tests la remplacent par une liste. */
  readonly enqueue?: Enqueue;
  /** La mise en file de la planification ; celle de BullMQ par defaut. */
  readonly enqueuePlan?: (job: { importId: string; userId: string }) => Promise<void>;
}

export function createImportsRouter(options: ImportsRouterOptions = {}): Router {
  const router = Router();
  const enqueue = options.enqueue ?? enqueueCompanyStep;

  router.use(requireAuth, requireAcceptedTerms);

  /**
   * Ce qu'un import consommerait, avant de le lancer (F-1402). Sert a
   * l'ecran de confirmation, et se demande aussi seul.
   */
  router.post('/estimation', (req, res, next) => {
    void (async () => {
      try {
        const user = req.currentUser;
        if (user === undefined) {
          next(unauthenticated());
          return;
        }

        const parsed = estimateSchema.safeParse(req.body);
        if (!parsed.success) {
          next(
            AppError.badRequest(
              'invalid_estimate',
              'Estimation impossible',
              "Indiquez le nombre de lignes et les parametres de l'import.",
            ),
          );
          return;
        }

        res.json({
          estimate: await estimateImport(user.id, parsed.data.rows, parsed.data.settings),
        });
      } catch (error) {
        next(error);
      }
    })();
  });

  router.post('/', express.json({ limit: BODY_LIMIT }), (req, res, next) => {
    void (async () => {
      try {
        const user = req.currentUser;
        if (user === undefined) {
          next(unauthenticated());
          return;
        }

        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) {
          if (parsed.error.issues.some((issue) => issue.path[0] === 'settings')) {
            next(
              AppError.badRequest(
                'invalid_settings',
                'Parametres refuses',
                "Les parametres de l'import ne sont pas valides : profondeur, types d'adresses, fournisseurs ou etiquettes.",
              ),
            );
            return;
          }
          next(
            AppError.badRequest(
              'invalid_import',
              'Import refuse',
              `Le fichier envoye ne respecte pas les limites : ${MAX_ROWS} lignes et ${MAX_COLUMNS} colonnes au plus.`,
            ),
          );
          return;
        }

        const { filename, headers, mapping, rows, settings, confirmedEstimate } = parsed.data;

        // F-1402 : au-dela du seuil, l'import ne part pas sans que
        // l'utilisateur ait vu ce qu'il va consommer. Le refus porte
        // l'estimation, pour que l'interface n'ait pas a la redemander.
        const estimation = await estimateImport(user.id, rows.length, settings);
        if (estimation.needsConfirmation && !confirmedEstimate) {
          res.status(409).json({
            type: 'about:blank',
            title: 'Confirmation demandee',
            status: 409,
            code: 'estimate_not_confirmed',
            detail: `Cet import porte sur ${String(rows.length)} lignes. Confirmez apres avoir lu ce qu'il va consommer.`,
            estimate: estimation,
          });
          return;
        }

        const resume = await submitImport(
          { userId: user.id, filename, headers, mapping, rows, settings },
          options.enqueuePlan === undefined ? {} : { enqueuePlan: options.enqueuePlan },
        );
        res.status(201).json({ import: resume });
      } catch (error) {
        next(error);
      }
    })();
  });

  router.get('/', (req, res, next) => {
    void (async () => {
      try {
        const user = req.currentUser;
        if (user === undefined) {
          next(unauthenticated());
          return;
        }
        res.json({ imports: await listImports(user.id) });
      } catch (error) {
        next(error);
      }
    })();
  });

  router.get('/:id', (req, res, next) => {
    void (async () => {
      try {
        const user = req.currentUser;
        if (user === undefined) {
          next(unauthenticated());
          return;
        }

        const identifiant = req.params.id ?? '';
        const resume = await findImport(user.id, identifiant);
        if (resume === undefined) {
          // 404 et non 403 : un import d'un autre compte n'existe pas (S-04).
          next(AppError.notFound("Cet import n'existe pas."));
          return;
        }

        res.json({
          import: resume,
          rejectedRows: await listRejectedRows(user.id, identifiant),
          progress: await importProgress(user.id, identifiant),
        });
      } catch (error) {
        next(error);
      }
    })();
  });

  /**
   * Les adresses trouvees par l'import, avec leur statut, leur score et le
   * detail de son calcul (6.9).
   */
  router.get('/:id/emails', (req, res, next) => {
    void (async () => {
      try {
        const user = req.currentUser;
        if (user === undefined) {
          next(unauthenticated());
          return;
        }
        const identifiant = req.params.id ?? '';
        if ((await findImport(user.id, identifiant)) === undefined) {
          next(AppError.notFound("Cet import n'existe pas."));
          return;
        }
        res.json(await listImportEmails(user.id, identifiant));
      } catch (error) {
        next(error);
      }
    })();
  });

  /**
   * Annulation en cours de route (F-205). Les entreprises deja creees restent
   * dans la bibliotheque : elles ont ete trouvees, les effacer serait punir
   * l'utilisateur d'avoir change d'avis.
   */
  /**
   * Relance d'un import arrete par un quota (F-1403). Rien ne se perd en
   * attendant : les entreprises gardent leur place dans l'import, et
   * l'entretien quotidien les reprendrait de lui-meme au renouvellement.
   */
  router.post('/:id/resume', (req, res, next) => {
    void (async () => {
      try {
        const user = req.currentUser;
        if (user === undefined) {
          next(unauthenticated());
          return;
        }

        const identifiant = req.params.id ?? '';
        const existe = await findImport(user.id, identifiant);
        if (existe === undefined) {
          next(AppError.notFound("Cet import n'existe pas."));
          return;
        }

        const issue = await resumeBlocked(user.id, enqueue, identifiant);
        if (issue.blockedBy !== undefined) {
          next(
            new AppError({
              status: 429,
              code: 'quota_reached',
              title: 'Quota toujours atteint',
              detail:
                'Le compteur du mois est plein. Les entreprises repartiront au renouvellement, sans rien faire de votre part.',
            }),
          );
          return;
        }

        res.json({
          resumed: issue.resumed,
          import: await findImport(user.id, identifiant),
          quotas: await quotaReport(user.id),
        });
      } catch (error) {
        next(error);
      }
    })();
  });

  router.post('/:id/cancel', (req, res, next) => {
    void (async () => {
      try {
        const user = req.currentUser;
        if (user === undefined) {
          next(unauthenticated());
          return;
        }

        const identifiant = req.params.id ?? '';
        const annule = await cancelImport(user.id, identifiant);
        if (!annule) {
          const existe = await findImport(user.id, identifiant);
          next(
            existe === undefined
              ? AppError.notFound("Cet import n'existe pas.")
              : AppError.badRequest(
                  'import_not_cancellable',
                  'Import deja termine',
                  "Cet import n'est plus en cours : il n'y a rien a annuler.",
                ),
          );
          return;
        }

        res.json({ import: await findImport(user.id, identifiant) });
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
