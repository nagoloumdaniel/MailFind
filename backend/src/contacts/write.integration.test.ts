import type { Express, RequestHandler } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import type { VerifyDeps } from '../pipeline/verify.js';
import { addSuppressions } from '../suppressions/repository.js';
import { createUser, resetData } from '../test/integration/db.js';
import { createTestSession } from '../test/session.js';

let app: Express;
let userId: string;

/** Un DNS simule : acme.fr et autre.fr recoivent du courrier, rien d'autre. */
const VERIFICATION: VerifyDeps = {
  mailDns: {
    mx: (domaine) =>
      ['acme.fr', 'autre.fr'].includes(domaine)
        ? Promise.resolve([{ exchange: `mx.${domaine}`, priority: 10 }])
        : Promise.reject(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })),
    hasAddress: () => Promise.resolve(false),
  },
  disposableDomains: () => Promise.resolve(new Set(['yopmail.com'])),
  verificationLimits: { perUserMonthly: 0, globalMonthly: 0 },
};

beforeAll(async () => {
  const { createApp } = await import('../app.js');
  const base = createTestSession();
  const connecte: RequestHandler = (req, res, next) => {
    base(req, res, (erreur?: unknown) => {
      if (erreur !== undefined) {
        next(erreur);
        return;
      }
      req.session.userId = userId;
      next();
    });
  };
  app = createApp({ logger: pino({ level: 'silent' }), session: connecte, verify: VERIFICATION });
});

beforeEach(async () => {
  await resetData();
  userId = await createUser();
});

afterAll(async () => {
  await closePool();
});

async function agentAvecJeton() {
  const agent = request.agent(app);
  const reponse = await agent.get('/api/auth/me');
  const cookies = reponse.headers['set-cookie'] as unknown as string[];
  const jeton =
    cookies
      .find((cookie) => cookie.startsWith('mailfind.csrf='))
      ?.split(';')[0]
      ?.slice('mailfind.csrf='.length) ?? '';
  return {
    post: (url: string, corps: object) => agent.post(url).set('x-csrf-token', jeton).send(corps),
    patch: (url: string, corps: object) => agent.patch(url).set('x-csrf-token', jeton).send(corps),
  };
}

describe('POST /api/contacts (F-1013)', () => {
  it('cree un contact et son entreprise, avec sa source, son statut et son score', async () => {
    const { post } = await agentAvecJeton();
    const reponse = await post('/api/contacts', {
      address: 'Recrutement@Acme.fr',
      newCompany: { name: 'Acme', domain: 'https://www.acme.fr' },
      contactName: 'Service recrutement',
      salutation: 'Madame, Monsieur',
      tags: ['Salon', 'salon', 'Lyon'],
    });

    expect(reponse.status).toBe(201);
    expect(reponse.body.contact).toMatchObject({
      address: 'Recrutement@Acme.fr',
      contactName: 'Service recrutement',
      salutation: 'Madame, Monsieur',
      tags: ['salon', 'lyon'],
      company: { name: 'Acme', domain: 'acme.fr' },
      type: 'recruitment',
      origin: 'manual',
      status: 'unverified',
      source: { kind: 'manual' },
    });
    // Type recherche par defaut, sans source sur le site : 5 points.
    expect(reponse.body.contact.score).toBe(5);
    const audit = await query<{ action: string }>('select action from audit_events');
    expect(audit.rows.map((r) => r.action)).toContain('contact.created');
  });

  it('rattache le contact a une entreprise existante du compte, et a elle seule', async () => {
    const { post } = await agentAvecJeton();
    const premiere = await post('/api/contacts', {
      address: 'rh@acme.fr',
      newCompany: { name: 'Acme', domain: 'acme.fr' },
    });
    const companyId = premiere.body.contact.company.id as string;
    const seconde = await post('/api/contacts', { address: 'jobs@acme.fr', companyId });
    expect(seconde.status).toBe(201);
    expect(seconde.body.contact.company.id).toBe(companyId);

    const autre = await createUser();
    const etrangere = await query<{ id: string }>(
      `insert into companies (user_id, name, normalized_name) values ($1, 'X', 'x') returning id`,
      [autre],
    );
    const refusee = await post('/api/contacts', {
      address: 'a@acme.fr',
      companyId: etrangere.rows[0]?.id,
    });
    expect(refusee.status).toBe(404);
  });

  it('refuse une adresse mal formee, en double ou supprimee', async () => {
    const { post } = await agentAvecJeton();
    const nouvelle = { newCompany: { name: 'Acme', domain: 'acme.fr' } };
    expect(
      (await post('/api/contacts', { address: 'pas une adresse', ...nouvelle })).body,
    ).toMatchObject({
      code: 'invalid_address',
    });
    await post('/api/contacts', { address: 'rh@acme.fr', ...nouvelle });
    expect((await post('/api/contacts', { address: 'RH@acme.fr', ...nouvelle })).status).toBe(409);
    await addSuppressions(userId, ['ne.plus@acme.fr'], undefined);
    const supprimee = await post('/api/contacts', { address: 'ne.plus@acme.fr', ...nouvelle });
    expect(supprimee.status).toBe(409);
    expect(supprimee.body).toMatchObject({ code: 'address_suppressed' });
    const sansEntreprise = await post('/api/contacts', { address: 'x@acme.fr' });
    expect(sansEntreprise.body).toMatchObject({ code: 'invalid_contact' });
    expect(sansEntreprise.body.detail).toMatch(/entreprise/);
  });

  it('met une adresse jetable a jetable, score 0', async () => {
    const { post } = await agentAvecJeton();
    const reponse = await post('/api/contacts', {
      address: 'x@yopmail.com',
      newCompany: { name: 'Acme', domain: 'acme.fr' },
    });
    expect(reponse.body.contact).toMatchObject({ status: 'disposable', score: 0 });
  });
});

describe('PATCH /api/contacts/:id (F-1014)', () => {
  it('modifie les champs sans refaire la verification', async () => {
    const { post, patch } = await agentAvecJeton();
    const cree = await post('/api/contacts', {
      address: 'rh@acme.fr',
      newCompany: { name: 'Acme', domain: 'acme.fr' },
    });
    const id = cree.body.contact.id as string;
    const reponse = await patch(`/api/contacts/${id}`, {
      contactName: 'Julie Martin',
      salutation: 'Madame',
      type: 'recruitment',
      tags: ['alternance'],
    });
    expect(reponse.status).toBe(200);
    expect(reponse.body.contact).toMatchObject({
      contactName: 'Julie Martin',
      salutation: 'Madame',
      type: 'recruitment',
      tags: ['alternance'],
      origin: 'manual',
    });
    const historique = await query<{ n: number }>('select count(*)::int as n from verifications');
    expect(historique.rows[0]?.n).toBe(1);
  });

  it('verifie a nouveau une adresse corrigee, et garde l historique de l ancienne', async () => {
    const { patch } = await agentAvecJeton();
    // Une adresse trouvee sur le site, avec sa page.
    const entreprise = await query<{ id: string }>(
      `insert into companies (user_id, name, normalized_name, domain) values ($1, 'Acme', 'acme', 'acme.fr') returning id`,
      [userId],
    );
    const trouvee = await query<{ id: string }>(
      `with e as (
         insert into emails (company_id, user_id, address, normalized_address, local_part, type, origin)
         values ($1, $2, 'contact@acme.fr', 'contact@acme.fr', 'contact', 'generic', 'found') returning id
       )
       insert into email_sources (email_id, kind, url, extraction_method)
       select id, 'website', 'https://acme.fr/contact', 'mailto' from e returning email_id as id`,
      [entreprise.rows[0]?.id, userId],
    );
    const id = trouvee.rows[0]?.id ?? '';
    await query(
      `insert into verifications (email_id, level, status, reason, address)
       values ($1, 7, 'unverified', 'Controles locaux passes.', 'contact@acme.fr')`,
      [id],
    );

    const reponse = await patch(`/api/contacts/${id}`, { address: 'jobs@autre.fr' });
    expect(reponse.status).toBe(200);
    expect(reponse.body.contact).toMatchObject({
      address: 'jobs@autre.fr',
      origin: 'manual',
      type: 'recruitment',
      status: 'unverified',
    });
    const sources = await query<{ kind: string; excerpt: string }>(
      'select kind::text as kind, context_excerpt as excerpt from email_sources where email_id = $1',
      [id],
    );
    expect(sources.rows).toEqual([
      {
        kind: 'manual',
        excerpt:
          "Adresse corrigee par l'utilisateur ; ancienne adresse contact@acme.fr, vue sur https://acme.fr/contact.",
      },
    ]);
    const historique = await query<{ address: string }>(
      'select address from verifications where email_id = $1 order by verified_at',
      [id],
    );
    expect(historique.rows.map((r) => r.address)).toEqual(['contact@acme.fr', 'jobs@autre.fr']);
  });

  it('refuse une correction vers une adresse deja presente, ou le contact d un autre compte', async () => {
    const { post, patch } = await agentAvecJeton();
    const nouvelle = { newCompany: { name: 'Acme', domain: 'acme.fr' } };
    await post('/api/contacts', { address: 'rh@acme.fr', ...nouvelle });
    const second = await post('/api/contacts', { address: 'jobs@acme.fr', ...nouvelle });
    const id = second.body.contact.id as string;
    expect((await patch(`/api/contacts/${id}`, { address: 'rh@acme.fr' })).status).toBe(409);

    userId = await createUser();
    const autre = await agentAvecJeton();
    expect((await autre.patch(`/api/contacts/${id}`, { contactName: 'x' })).status).toBe(404);
  });
});

describe('POST /api/contacts/delete (F-1015, R-05)', () => {
  it('efface les contacts choisis, leurs sources et leurs verifications, et eux seuls', async () => {
    const { post } = await agentAvecJeton();
    const nouvelle = { newCompany: { name: 'Acme', domain: 'acme.fr' } };
    const a = await post('/api/contacts', { address: 'rh@acme.fr', ...nouvelle });
    const b = await post('/api/contacts', { address: 'jobs@acme.fr', ...nouvelle });
    await post('/api/contacts', { address: 'contact@acme.fr', ...nouvelle });

    const reponse = await post('/api/contacts/delete', {
      ids: [a.body.contact.id, b.body.contact.id],
    });
    expect(reponse.body).toEqual({ deleted: 2, suppressed: 0 });
    const restes = await query<{ address: string }>('select address from emails');
    expect(restes.rows).toEqual([{ address: 'contact@acme.fr' }]);
    const orphelines = await query<{ n: number }>(
      `select (select count(*) from email_sources)::int + (select count(*) from verifications)::int as n`,
    );
    // Il reste la source et la verification du contact garde, rien d'autre.
    expect(orphelines.rows[0]?.n).toBe(2);
  });

  it('ajoute a la liste de suppression sur demande, et la collecte ne les reprend plus', async () => {
    const { post } = await agentAvecJeton();
    const cree = await post('/api/contacts', {
      address: 'rh@acme.fr',
      newCompany: { name: 'Acme', domain: 'acme.fr' },
    });
    const reponse = await post('/api/contacts/delete', {
      ids: [cree.body.contact.id],
      suppress: true,
    });
    expect(reponse.body).toEqual({ deleted: 1, suppressed: 1 });
    const recreee = await post('/api/contacts', {
      address: 'rh@acme.fr',
      companyId: cree.body.contact.company.id,
    });
    expect(recreee.body).toMatchObject({ code: 'address_suppressed' });
    const audit = await query<{ metadata: { deleted: number; suppressed: number } }>(
      `select metadata from audit_events where action = 'contact.deleted'`,
    );
    expect(audit.rows[0]?.metadata).toMatchObject({ deleted: 1, suppressed: 1 });
    expect(JSON.stringify(audit.rows)).not.toContain('rh@acme.fr');
  });

  it('ne touche pas aux contacts d un autre compte', async () => {
    const { post } = await agentAvecJeton();
    const cree = await post('/api/contacts', {
      address: 'rh@acme.fr',
      newCompany: { name: 'Acme', domain: 'acme.fr' },
    });
    userId = await createUser();
    const autre = await agentAvecJeton();
    const reponse = await autre.post('/api/contacts/delete', {
      ids: [cree.body.contact.id],
      suppress: true,
    });
    expect(reponse.body).toEqual({ deleted: 0, suppressed: 0 });
    expect((await query<{ n: number }>('select count(*)::int as n from emails')).rows[0]?.n).toBe(
      1,
    );
  });
});
