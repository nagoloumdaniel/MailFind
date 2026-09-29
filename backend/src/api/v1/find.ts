import type { Router } from 'express';
import { z } from 'zod';
import { requireScope } from '../../api-keys/authenticate.js';
import { normalizeDomain } from '../../companies/normalize.js';
import { query } from '../../db/pool.js';
import { withUser } from '../../http/handler.js';
import { AppError } from '../../http/problem.js';
import { planImport } from '../../imports/plan.js';
import { submitImport } from '../../imports/submit.js';
import { enqueueImportPlan } from '../../queue/queues.js';
import { apiSettingsSchema, reglages } from './imports.js';
import { COMPANY_COLUMNS, emailsOfCompanies, type ApiCompany } from './serialize.js';

const rechercheSchema = z
  .object({
    name: z.string().trim().min(1).max(300).optional(),
    domain: z.string().trim().min(1).max(300).optional(),
    url: z.string().trim().min(1).max(2000).optional(),
    city: z.string().trim().max(200).optional(),
    settings: apiSettingsSchema.optional(),
  })
  .strict()
  .refine((r) => r.name !== undefined || r.domain !== undefined || r.url !== undefined, {
    message: 'name, domain ou url.',
  });

type Fiche = ApiCompany & { linkedin_url: string | null; phone: string | null };

async function fiche(userId: string, id: string): Promise<Fiche | undefined> {
  const lignes = await query<Fiche>(
    `select ${COMPANY_COLUMNS}, c.linkedin_url, c.phone
       from companies c where c.id = $1 and c.user_id = $2`,
    [id, userId],
  );
  return lignes.rows[0];
}

/** La reponse de l'annexe C : l'entreprise, ses adresses et ses canaux alternatifs. */
async function reponseAnnexeC(userId: string, entreprise: Fiche, cached: boolean) {
  const adresses = await emailsOfCompanies(userId, [entreprise.id]);
  const { linkedin_url, phone, ...company } = entreprise;
  return {
    company,
    emails: adresses.get(entreprise.id) ?? [],
    alternatives: {
      contact_form_url: entreprise.contact_form_url,
      careers_url: entreprise.careers_url,
      linkedin_url,
      phone,
    },
    cached,
  };
}

/**
 * Les adresses d'une entreprise (6.13, annexe C). Deja dans la bibliotheque
 * et deja exploree, elle est rendue tout de suite, sans rien depenser ;
 * sinon la recherche part comme un import d'une ligne, et la reponse porte
 * l'import a suivre (`GET /v1/imports/{id}`).
 *
 * Portee `imports:write` : une recherche nouvelle lance une collecte, qui
 * peut consommer des credits.
 */
export function registerFind(router: Router): void {
  router.post(
    '/find',
    requireScope('imports:write'),
    withUser(async (req, res, user) => {
      const lu = rechercheSchema.safeParse(req.body);
      if (!lu.success) {
        throw AppError.badRequest(
          'invalid_find',
          'Recherche refusee',
          'Donnez au moins name, domain ou url.',
        );
      }
      const { name, domain, url, city, settings } = lu.data;

      const domaine = normalizeDomain(domain ?? url ?? '');
      if (domaine !== undefined) {
        const connue = await query<{ id: string }>(
          `select id from companies
            where user_id = $1 and domain = $2 and crawl_status = 'done'`,
          [user.id, domaine],
        );
        const id = connue.rows[0]?.id;
        const trouvee = id === undefined ? undefined : await fiche(user.id, id);
        if (trouvee !== undefined) {
          res.json(await reponseAnnexeC(user.id, trouvee, true));
          return;
        }
      }

      const champs: [string, string | undefined][] = [
        ['company_name', name],
        ['domain', domain],
        ['website_url', url],
        ['city', city],
      ];
      const presents = champs.filter((c): c is [string, string] => c[1] !== undefined);
      const resume = await submitImport(
        {
          userId: user.id,
          filename: 'API : recherche',
          headers: presents.map(([k]) => k),
          mapping: presents.map(([k]) => k as 'company_name' | 'domain' | 'website_url' | 'city'),
          rows: [presents.map(([, v]) => v)],
          settings: reglages(settings),
        },
        { enqueue: false },
      );
      await planImport(resume.id, user.id);
      await enqueueImportPlan({ importId: resume.id, userId: user.id });
      const ligne = await query<{ company_id: string | null }>(
        'select company_id from import_rows where import_id = $1 and line = 2',
        [resume.id],
      );
      res.status(202).json({
        status: 'pending',
        import_id: resume.id,
        company_id: ligne.rows[0]?.company_id ?? null,
      });
    }),
  );
}
