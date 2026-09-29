import express, { type Router } from 'express';
import { z } from 'zod';
import { requireScope } from '../../api-keys/authenticate.js';
import { query } from '../../db/pool.js';
import { withUser } from '../../http/handler.js';
import { AppError } from '../../http/problem.js';
import { isKnownField, type KnownField } from '../../imports/fields.js';
import { cancelImport } from '../../imports/plan.js';
import { findImport, importProgress, listRejectedRows } from '../../imports/repository.js';
import {
  CRAWL_DEPTHS,
  EMAIL_TYPES,
  importSettingsSchema,
  MAILBOX_CHECKS,
  PROVIDERS,
} from '../../imports/settings.js';
import { submitImport } from '../../imports/submit.js';
import { cursorCondition, cursorOrder, parsePageParams, toPage } from '../pagination.js';
import { parseCsv } from './csv.js';
import { pathId } from './params.js';
import {
  COMPANY_COLUMNS,
  emailsOfCompanies,
  serializeImport,
  serializeProgress,
  type ApiCompany,
} from './serialize.js';

/** F-201 : les memes limites qu'a l'ecran. */
const MAX_ROWS = 5000;
const MAX_COLUMNS = 100;
const MAX_CSV = 5_000_000;

/** Le corps d'un import depasse la limite generale ; le routeur le lit avec celle-ci. */
export const IMPORT_BODY_LIMIT = '12mb';

const valeur = z.union([
  z.string().max(10_000),
  z.number(),
  z.array(z.string().max(200)),
  z.null(),
]);

/** Les reglages d'un import tels que l'API les recoit, en snake_case. */
export const apiSettingsSchema = z
  .object({
    depth: z.enum(CRAWL_DEPTHS).optional(),
    email_types: z.array(z.enum(EMAIL_TYPES)).optional(),
    providers: z.array(z.enum(PROVIDERS)).optional(),
    mailbox_check: z.enum(MAILBOX_CHECKS).optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict();

export const importCreationSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    companies: z
      .array(z.record(z.string().max(300), valeur))
      .min(1)
      .max(MAX_ROWS)
      .optional(),
    csv: z.string().max(MAX_CSV).optional(),
    settings: apiSettingsSchema.optional(),
  })
  .strict();

interface Tableau {
  readonly headers: string[];
  readonly mapping: (KnownField | null)[];
  readonly rows: string[][];
}

function enTexte(v: z.infer<typeof valeur>): string {
  if (v === null) return '';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

/**
 * Des objets JSON en tableau : une colonne par cle, dans l'ordre ou elles
 * apparaissent. Une cle qui n'est pas un champ connu est gardee comme
 * colonne libre, comme une colonne non reconnue d'un fichier (F-203).
 */
function depuisObjets(objets: readonly Record<string, z.infer<typeof valeur>>[]): Tableau {
  const headers: string[] = [];
  for (const objet of objets) {
    for (const cle of Object.keys(objet)) if (!headers.includes(cle)) headers.push(cle);
  }
  return {
    headers,
    mapping: headers.map((h) => (isKnownField(h) ? h : null)),
    rows: objets.map((objet) => headers.map((h) => enTexte(objet[h] ?? null))),
  };
}

/** Un CSV dont l'en-tete nomme les champs connus ; les autres colonnes restent libres. */
function depuisCsv(texte: string): Tableau {
  const [entete, ...lignes] = parseCsv(texte);
  if (entete === undefined || lignes.length === 0) {
    throw AppError.badRequest(
      'invalid_import',
      'Import refuse',
      'Le CSV doit avoir un en-tete et au moins une ligne.',
    );
  }
  const headers = entete.map((h) => h.trim());
  return {
    headers,
    mapping: headers.map((h) => {
      const champ = h.toLowerCase();
      return isKnownField(champ) ? champ : null;
    }),
    rows: lignes.map((l) => headers.map((_, i) => l[i] ?? '')),
  };
}

/** Les reglages d'un import en snake_case, traduits vers ceux de l'interface. */
export function reglages(brut: z.infer<typeof apiSettingsSchema> | undefined) {
  const r = brut ?? {};
  const lu = importSettingsSchema.safeParse({
    ...(r.depth === undefined ? {} : { depth: r.depth }),
    ...(r.email_types === undefined ? {} : { emailTypes: r.email_types }),
    ...(r.providers === undefined ? {} : { providers: r.providers }),
    ...(r.mailbox_check === undefined ? {} : { mailboxCheck: r.mailbox_check }),
    ...(r.tags === undefined ? {} : { tags: r.tags }),
  });
  if (!lu.success) {
    throw AppError.badRequest(
      'invalid_settings',
      'Parametres refuses',
      "Les parametres de l'import ne sont pas valides : profondeur, types d'adresses, fournisseurs ou etiquettes.",
    );
  }
  return lu.data;
}

async function importDuCompte(userId: string, brut: unknown) {
  const id = pathId(brut);
  const resume = id === undefined ? undefined : await findImport(userId, id);
  // 404 et non 403 : un import d'un autre compte n'existe pas (S-04).
  if (resume === undefined) throw AppError.notFound("Cet import n'existe pas.");
  return resume;
}

export function registerImports(router: Router): void {
  router.post(
    '/imports',
    requireScope('imports:write'),
    withUser(async (req, res, user) => {
      const lu = importCreationSchema.safeParse(req.body);
      if (!lu.success || (lu.data.companies === undefined) === (lu.data.csv === undefined)) {
        throw AppError.badRequest(
          'invalid_import',
          'Import refuse',
          `Envoyez soit companies (${String(MAX_ROWS)} lignes au plus), soit csv (5 Mo au plus), pas les deux.`,
        );
      }
      const tableau =
        lu.data.companies === undefined
          ? depuisCsv(lu.data.csv ?? '')
          : depuisObjets(lu.data.companies);
      if (tableau.rows.length > MAX_ROWS || tableau.headers.length > MAX_COLUMNS) {
        throw AppError.badRequest(
          'invalid_import',
          'Import refuse',
          `${String(MAX_ROWS)} lignes et ${String(MAX_COLUMNS)} colonnes au plus.`,
        );
      }
      const resume = await submitImport({
        userId: user.id,
        filename: lu.data.name ?? `api-${new Date().toISOString().slice(0, 10)}`,
        headers: tableau.headers,
        mapping: tableau.mapping,
        rows: tableau.rows,
        settings: reglages(lu.data.settings),
      });
      res.status(201).json({ import: serializeImport(resume) });
    }),
  );

  router.get(
    '/imports/:id',
    requireScope('companies:read'),
    withUser(async (req, res, user) => {
      const resume = await importDuCompte(user.id, req.params.id);
      res.json({
        import: serializeImport(resume),
        progress: serializeProgress(await importProgress(user.id, resume.id)),
        rejected_rows: await listRejectedRows(user.id, resume.id),
      });
    }),
  );

  router.get(
    '/imports/:id/results',
    requireScope('companies:read'),
    withUser(async (req, res, user) => {
      const resume = await importDuCompte(user.id, req.params.id);
      const { limit, cursor } = parsePageParams(req.query);
      const entreprises = await query<ApiCompany>(
        `select ${COMPANY_COLUMNS}
           from companies c
          where c.user_id = $1
            and c.id in (select company_id from import_rows
                          where import_id = $2 and company_id is not null)
            and ${cursorCondition('c', 3, 4)}
          order by ${cursorOrder('c')}
          limit $5`,
        [user.id, resume.id, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
      );
      const page = toPage(entreprises.rows, limit, (c) => ({ createdAt: c.created_at, id: c.id }));
      const adresses = await emailsOfCompanies(
        user.id,
        page.data.map((c) => c.id),
      );
      res.json({
        data: page.data.map((c) => ({ ...c, emails: adresses.get(c.id) ?? [] })),
        next_cursor: page.next_cursor,
      });
    }),
  );

  router.post(
    '/imports/:id/cancel',
    requireScope('imports:write'),
    withUser(async (req, res, user) => {
      const resume = await importDuCompte(user.id, req.params.id);
      if (!(await cancelImport(user.id, resume.id))) {
        throw new AppError({
          status: 409,
          code: 'import_not_cancellable',
          title: 'Import deja termine',
          detail: "Cet import n'est plus en cours : il n'y a rien a annuler.",
        });
      }
      res.json({ import: serializeImport(await importDuCompte(user.id, resume.id)) });
    }),
  );
}

/** Le lecteur de corps a la limite d'un import, pour la seule creation. */
export const importBodyParser = express.json({ limit: IMPORT_BODY_LIMIT });
