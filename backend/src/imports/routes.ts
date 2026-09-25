import express, { Router } from 'express';
import { z } from 'zod';
import { recordAuditEvent } from '../audit/repository.js';
import { requireAuth, unauthenticated } from '../http/middleware/require-auth.js';
import { requireAcceptedTerms } from '../http/middleware/require-terms.js';
import { AppError } from '../http/problem.js';
import { KNOWN_FIELDS } from './fields.js';
import {
  createImport,
  findImport,
  listImports,
  listRejectedRows,
  type PreparedRow,
} from './repository.js';
import { validateRow } from './validate.js';

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
  settings: z.record(z.string(), z.unknown()).optional(),
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

        if (mapping.length !== headers.length) {
          next(
            AppError.badRequest(
              'mapping_mismatch',
              'Import refuse',
              "La correspondance des colonnes ne correspond pas a l'en-tete du fichier.",
            ),
          );
          return;
        }

        // La validation est refaite ici en entier. L'apercu du navigateur est
        // un service rendu a l'utilisateur, pas une autorite (S-07).
        const preparees: PreparedRow[] = rows.map((row, index) => {
          const verdict = validateRow(headers, mapping, row);
          const raw: Record<string, string> = {};
          headers.forEach((header, colonne) => {
            const valeur = row[colonne];
            if (valeur !== undefined && valeur !== '') raw[header] = valeur;
          });

          return verdict.accepted
            ? { line: index + 2, raw, status: 'accepted', error: undefined }
            : { line: index + 2, raw, status: 'rejected', error: verdict.reason };
        });

        if (preparees.every((ligne) => ligne.status === 'rejected')) {
          next(
            AppError.badRequest(
              'no_usable_row',
              'Aucune ligne exploitable',
              "Aucune ligne de ce fichier ne porte de nom d'entreprise, de domaine, de site ou de page carrieres.",
            ),
          );
          return;
        }

        const resume = await createImport({
          userId: user.id,
          filename,
          settings: settings ?? {},
          rows: preparees,
        });

        await recordAuditEvent({
          userId: user.id,
          action: 'import.created',
          entity: 'import',
          entityId: resume.id,
          // Des compteurs, pas de contenu : le journal d'audit ne porte aucune
          // donnee du fichier (S-03).
          metadata: {
            totalRows: resume.totalRows,
            acceptedRows: resume.acceptedRows,
            rejectedRows: resume.rejectedRows,
          },
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
        });
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
