import { Router } from 'express';
import { withUser } from '../http/handler.js';
import { requireAuth } from '../http/middleware/require-auth.js';
import { requireAcceptedTerms } from '../http/middleware/require-terms.js';
import { AppError } from '../http/problem.js';
import { contactQuerySchema } from './query.js';
import { findContact, listContacts } from './repository.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createContactsRouter(): Router {
  const router = Router();
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

  return router;
}
