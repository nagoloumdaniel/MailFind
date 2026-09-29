import { Router } from 'express';
import { recordAuditEvent } from '../audit/repository.js';
import { withUser } from '../http/handler.js';
import { requireAuth } from '../http/middleware/require-auth.js';
import { requireAcceptedTerms } from '../http/middleware/require-terms.js';
import { AppError } from '../http/problem.js';
import { contactQuerySchema } from './query.js';
import { findContact, listContacts } from './repository.js';
import type { VerifyDeps } from '../pipeline/verify.js';
import { createVerifyDeps } from '../pipeline/verify-deps.js';
import {
  bulkContacts,
  bulkContactsSchema,
  createContact,
  createContactSchema,
  deleteContacts,
  deleteContactsSchema,
  updateContact,
  updateContactSchema,
} from './write.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIBELLES: Record<string, string> = {
  address: "l'adresse",
  companyId: "l'entreprise",
  newCompany: 'la nouvelle entreprise',
  contactName: 'le nom',
  salutation: 'la civilite',
  type: 'le type',
  tags: 'les etiquettes',
};

/** Le premier probleme, dit en francais : les messages de zod sont en anglais. */
function refus(
  issues: readonly { code: string; message: string; path: PropertyKey[] }[],
): AppError {
  const premier = issues[0];
  const champ = String(premier?.path[0] ?? '');
  const detail =
    premier?.code === 'custom'
      ? premier.message
      : `Valeur refusee pour ${LIBELLES[champ] ?? champ}.`;
  return AppError.badRequest('invalid_contact', 'Contact refuse', detail);
}

export function createContactsRouter(options: { verify?: VerifyDeps } = {}): Router {
  const router = Router();
  // Construites a la premiere ecriture : lire l'environnement des fournisseurs
  // n'a pas a bloquer le demarrage de l'API.
  let verification = options.verify;
  const deps = () => (verification ??= createVerifyDeps());
  router.use(requireAuth, requireAcceptedTerms);

  router.get(
    '/',
    withUser(async (req, res, user) => {
      const lu = contactQuerySchema.safeParse(req.query);
      if (!lu.success) {
        throw AppError.badRequest(
          'invalid_contact_query',
          'Recherche refusee',
          "Un tri, un filtre ou une taille de page n'est pas reconnu.",
        );
      }
      const { total, contacts } = await listContacts(user.id, lu.data);
      res.json({ total, page: lu.data.page, pageSize: lu.data.pageSize, contacts });
    }),
  );

  router.get(
    '/:id',
    withUser(async (req, res, user) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      // 404 et non 403 : le contact d'un autre compte n'existe pas (S-04).
      const contact = UUID.test(id) ? await findContact(user.id, id) : undefined;
      if (contact === undefined) throw AppError.notFound("Ce contact n'existe pas.");
      res.json({ contact });
    }),
  );

  router.post(
    '/',
    withUser(async (req, res, user) => {
      const lu = createContactSchema.safeParse(req.body);
      if (!lu.success) throw refus(lu.error.issues);
      const id = await createContact(deps(), user.id, lu.data);
      await recordAuditEvent({
        userId: user.id,
        action: 'contact.created',
        entity: 'email',
        entityId: id,
      });
      res.status(201).json({ contact: await findContact(user.id, id) });
    }),
  );

  router.post(
    '/bulk',
    withUser(async (req, res, user) => {
      const lu = bulkContactsSchema.safeParse(req.body);
      if (!lu.success) {
        throw AppError.badRequest(
          'invalid_bulk_action',
          'Action refusee',
          'Action inconnue, ou selection trop grande : 1 000 contacts au plus, 200 pour une verification.',
        );
      }
      const resultat = await bulkContacts(deps(), user.id, lu.data);
      await recordAuditEvent({
        userId: user.id,
        action: 'contact.updated',
        entity: 'email',
        entityId: null,
        metadata: {
          bulk: lu.data.action,
          requested: lu.data.ids.length,
          updated: resultat.updated,
        },
      });
      res.json(resultat);
    }),
  );

  // Un POST plutot qu'un DELETE : une suppression en masse porte une liste
  // d'identifiants, et un corps de DELETE est mal tenu par les intermediaires.
  router.post(
    '/delete',
    withUser(async (req, res, user) => {
      const lu = deleteContactsSchema.safeParse(req.body);
      if (!lu.success) {
        throw AppError.badRequest(
          'invalid_contact_selection',
          'Selection refusee',
          'Entre 1 et 1 000 contacts par suppression.',
        );
      }
      const resultat = await deleteContacts(user.id, lu.data.ids, lu.data.suppress);
      await recordAuditEvent({
        userId: user.id,
        action: 'contact.deleted',
        entity: 'email',
        entityId: null,
        // Des compteurs, jamais d'adresse (S-03).
        metadata: { ...resultat, requested: lu.data.ids.length },
      });
      res.json(resultat);
    }),
  );

  router.patch(
    '/:id',
    withUser(async (req, res, user) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const lu = updateContactSchema.safeParse(req.body);
      if (!lu.success) throw refus(lu.error.issues);
      if (!UUID.test(id) || !(await updateContact(deps(), user.id, id, lu.data))) {
        throw AppError.notFound("Ce contact n'existe pas.");
      }
      await recordAuditEvent({
        userId: user.id,
        action: 'contact.updated',
        entity: 'email',
        entityId: id,
        // Les champs changes, jamais leurs valeurs (S-03).
        metadata: { fields: Object.keys(lu.data) },
      });
      res.json({ contact: await findContact(user.id, id) });
    }),
  );

  return router;
}
