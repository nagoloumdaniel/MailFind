import type { Router } from 'express';
import { z } from 'zod';
import { requireScope } from '../../api-keys/authenticate.js';
import { recordAuditEvent } from '../../audit/repository.js';
import { normalizeTags } from '../../companies/normalize.js';
import { bulkContacts, deleteContacts } from '../../contacts/write.js';
import { query } from '../../db/pool.js';
import { SHOWN_EMAIL } from '../../emails/visibility.js';
import { withUser } from '../../http/handler.js';
import { AppError } from '../../http/problem.js';
import { EMAIL_TYPES } from '../../imports/settings.js';
import type { VerifyDeps } from '../../pipeline/verify.js';
import { cursorCondition, cursorOrder, parsePageParams, toPage } from '../pagination.js';
import { pathId } from './params.js';
import { EMAIL_COLUMNS, type ApiEmail } from './serialize.js';

const STATUTS = [
  'valid',
  'accept_all',
  'risky',
  'unknown',
  'invalid',
  'disposable',
  'suppressed',
  'unverified',
] as const;
const TYPES = [...EMAIL_TYPES, 'support', 'personal', 'unknown'] as const;
const ORIGINES = ['found', 'provider', 'deduced', 'imported', 'manual'] as const;

/** Une liste separee par des virgules : `status=valid,accept_all`. */
const liste = <T extends string>(valeurs: readonly [T, ...T[]]) =>
  z
    .string()
    .transform((s) => s.split(',').map((v) => v.trim()))
    .pipe(z.array(z.enum(valeurs)).min(1))
    .optional();

export const emailFiltersSchema = z.object({
  company_id: z.uuid().optional(),
  status: liste(STATUTS),
  type: liste(TYPES),
  origin: liste(ORIGINES),
  tag: z.string().trim().toLowerCase().max(50).optional(),
  q: z.string().trim().max(320).optional(),
  excluded: z.enum(['true', 'false']).optional(),
});

/**
 * F-1303 ne prevoit pas de portee `emails:write` : modifier ou supprimer une
 * adresse est une ecriture dans la bibliotheque, sous `companies:write`.
 */
export const emailUpdateSchema = z
  .object({
    type: z.enum(EMAIL_TYPES).optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
    excluded: z.boolean().optional(),
  })
  .strict()
  .refine((m) => Object.keys(m).length > 0, { message: 'Rien a modifier.' });

type ApiEmailWithCompany = ApiEmail & { company_name: string; company_domain: string | null };

const COLONNES = `${EMAIL_COLUMNS}, c.name as company_name, c.domain as company_domain`;

async function adresseDuCompte(userId: string, brut: unknown): Promise<ApiEmailWithCompany> {
  const id = pathId(brut);
  const lignes =
    id === undefined
      ? { rows: [] }
      : await query<ApiEmailWithCompany>(
          `select ${COLONNES}
             from emails e join companies c on c.id = e.company_id
            where e.id = $1 and e.user_id = $2 and ${SHOWN_EMAIL}`,
          [id, userId],
        );
  const adresse = lignes.rows[0];
  if (adresse === undefined) throw AppError.notFound("Cette adresse n'existe pas.");
  return adresse;
}

export function registerEmails(router: Router, verifyDeps: () => VerifyDeps): void {
  router.get(
    '/emails',
    requireScope('emails:read'),
    withUser(async (req, res, user) => {
      const { limit, cursor } = parsePageParams(req.query);
      const lu = emailFiltersSchema.safeParse(req.query);
      if (!lu.success) {
        throw AppError.badRequest(
          'invalid_filter',
          'Filtre refuse',
          `Valeur refusee pour ${String(lu.error.issues[0]?.path[0] ?? 'un filtre')}.`,
        );
      }
      const f = lu.data;
      const valeurs: unknown[] = [user.id, cursor?.createdAt ?? null, cursor?.id ?? null];
      const conditions = ['e.user_id = $1', SHOWN_EMAIL, cursorCondition('e', 2, 3)];
      const ajouter = (sql: (n: string) => string, v: unknown) => {
        valeurs.push(v);
        conditions.push(sql(`$${String(valeurs.length)}`));
      };
      if (f.company_id !== undefined) ajouter((n) => `e.company_id = ${n}::uuid`, f.company_id);
      if (f.status !== undefined) ajouter((n) => `e.status::text = any(${n}::text[])`, f.status);
      if (f.type !== undefined) ajouter((n) => `e.type::text = any(${n}::text[])`, f.type);
      if (f.origin !== undefined) ajouter((n) => `e.origin::text = any(${n}::text[])`, f.origin);
      if (f.tag !== undefined) ajouter((n) => `${n} = any(e.tags)`, f.tag);
      if (f.q !== undefined && f.q !== '') {
        ajouter(
          (n) => `e.normalized_address like ${n}`,
          `%${f.q.toLowerCase().replace(/[%_\\]/g, '\\$&')}%`,
        );
      }
      if (f.excluded !== undefined) ajouter((n) => `e.excluded = ${n}::boolean`, f.excluded);
      valeurs.push(limit + 1);
      const lignes = await query<ApiEmailWithCompany>(
        `select ${COLONNES}
           from emails e join companies c on c.id = e.company_id
          where ${conditions.join(' and ')}
          order by ${cursorOrder('e')}
          limit $${String(valeurs.length)}`,
        valeurs,
      );
      res.json(toPage(lignes.rows, limit, (e) => ({ createdAt: e.created_at, id: e.id })));
    }),
  );

  router.patch(
    '/emails/:id',
    requireScope('companies:write'),
    withUser(async (req, res, user) => {
      const adresse = await adresseDuCompte(user.id, req.params.id);
      const lu = emailUpdateSchema.safeParse(req.body);
      if (!lu.success) {
        throw AppError.badRequest(
          'invalid_email_update',
          'Modification refusee',
          'Champs modifiables : type, tags (remplacees), excluded.',
        );
      }
      const ids = [adresse.id];
      const { type, tags, excluded } = lu.data;
      // Les memes chemins que les actions en masse de l'interface : le type
      // relance le calcul du score, et seule une exclusion decidee par
      // l'utilisateur se leve (D-20).
      if (type !== undefined)
        await bulkContacts(verifyDeps(), user.id, { action: 'type', ids, type });
      if (excluded !== undefined) {
        await bulkContacts(verifyDeps(), user.id, {
          action: excluded ? 'exclude' : 'include',
          ids,
        });
      }
      if (tags !== undefined) {
        await query(
          'update emails set tags = $3::text[], updated_at = now() where id = $1 and user_id = $2',
          [adresse.id, user.id, normalizeTags(tags.join(','))],
        );
      }
      await recordAuditEvent({
        userId: user.id,
        action: 'contact.updated',
        entity: 'email',
        entityId: adresse.id,
        metadata: { fields: Object.keys(lu.data), via: 'api' },
      });
      res.json({ email: await adresseDuCompte(user.id, adresse.id) });
    }),
  );

  /** R-05 : `?suppress=true` ajoute d'abord l'adresse a la liste de suppression. */
  router.delete(
    '/emails/:id',
    requireScope('companies:write'),
    withUser(async (req, res, user) => {
      const adresse = await adresseDuCompte(user.id, req.params.id);
      const { suppressed } = await deleteContacts(
        user.id,
        [adresse.id],
        req.query.suppress === 'true',
      );
      await recordAuditEvent({
        userId: user.id,
        action: 'contact.deleted',
        entity: 'email',
        entityId: adresse.id,
        metadata: { suppressed, via: 'api' },
      });
      res.json({ deleted: true, suppressed });
    }),
  );
}
