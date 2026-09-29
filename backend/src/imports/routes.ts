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
});

export function createImportsRouter(): Router {
  const router = Router();

  router.use(requireAuth, requireAcceptedTerms);

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

        const { filename, headers, mapping, rows, settings } = parsed.data;
        const resume = await submitImport({
          userId: user.id,
          filename,
          headers,
          mapping,
          rows,
          settings,
        });
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
