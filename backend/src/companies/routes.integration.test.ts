import type { Express, RequestHandler } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import { createUser, resetData } from '../test/integration/db.js';
import { createTestSession } from '../test/session.js';

let app: Express;
let userId: string;
const file: { step: string; companyId: string; importId: string }[] = [];

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
  app = createApp({
    logger: pino({ level: 'silent' }),
    session: connecte,
    enqueue: (step, job) => {
      file.push({ step, companyId: job.companyId, importId: job.importId });
      return Promise.resolve();
    },
  });
});

beforeEach(async () => {
  await resetData();
  userId = await createUser();
  file.length = 0;
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
    get: (url: string) => agent.get(url),
    post: (url: string, corps: object) => agent.post(url).set('x-csrf-token', jeton).send(corps),
    patch: (url: string, corps: object) => agent.patch(url).set('x-csrf-token', jeton).send(corps),
  };
}

afterAll(async () => {
  await closePool();
});

async function entreprise(
  nom: string,
  champs: { domain?: string; city?: string; industry?: string; tags?: string[]; crawl?: string },
  adresses: [string, string, string][] = [],
  proprietaire = userId,
): Promise<string> {
  const cree = await query<{ id: string }>(
    `insert into companies (user_id, name, normalized_name, domain, city, industry, tags, crawl_status)
     values ($1, $2, lower($2), $3, $4, $5, $6, $7::crawl_status) returning id`,
    [
      proprietaire,
      nom,
      champs.domain ?? null,
      champs.city ?? null,
      champs.industry ?? null,
      champs.tags ?? [],
      champs.crawl ?? 'done',
    ],
  );
  const id = cree.rows[0]?.id ?? '';
  for (const [adresse, type, statut] of adresses) {
    await query(
      `with e as (
         insert into emails (company_id, user_id, address, normalized_address, local_part, type,
                             origin, status, score)
         values ($1, $2, $3, $3, split_part($3, '@', 1), $4::email_type, 'found',
                 $5::email_status, 50) returning id)
       insert into email_sources (email_id, kind) select id, 'deduction' from e`,
      [id, proprietaire, adresse, type, statut],
    );
  }
  return id;
}

describe('GET /api/companies (F-1002)', () => {
  beforeEach(async () => {
    await entreprise(
      'Acme',
      { domain: 'acme.fr', city: 'Lyon', industry: 'Industrie', tags: ['salon'] },
      [
        ['rh@acme.fr', 'hr', 'valid'],
        ['jobs@acme.fr', 'recruitment', 'unverified'],
      ],
    );
    await entreprise('Boulangerie Martin', { city: 'Paris', industry: 'Commerce' }, [
      ['contact@boulangerie.fr', 'generic', 'valid'],
    ]);
    await entreprise('Cafe Zen', { city: 'lyon', crawl: 'failed' });
  });

  it('liste avec le resume des adresses, et trie par nombre d adresses', async () => {
    const reponse = await request(app).get('/api/companies?sort=emails&dir=desc');
    expect(reponse.body.total).toBe(3);
    expect(reponse.body.companies[0]).toMatchObject({
      name: 'Acme',
      emailCount: 2,
      validCount: 1,
      bestScore: 50,
      tags: ['salon'],
    });
    expect([...(reponse.body.companies[0].types as string[])].sort()).toEqual([
      'hr',
      'recruitment',
    ]);
    expect((reponse.body.companies as unknown[]).at(-1)).toMatchObject({
      name: 'Cafe Zen',
      emailCount: 0,
      types: [],
    });
  });

  it('cherche et combine ville, etiquette, statut de collecte et type present', async () => {
    const noms = async (url: string) =>
      ((await request(app).get(url)).body.companies as { name: string }[]).map((c) => c.name);
    expect(await noms('/api/companies?q=acme.fr')).toEqual(['Acme']);
    expect(await noms('/api/companies?city=LYON')).toEqual(['Acme', 'Cafe Zen']);
    expect(await noms('/api/companies?city=lyon&tag=salon')).toEqual(['Acme']);
    expect(await noms('/api/companies?crawlStatus=failed')).toEqual(['Cafe Zen']);
    expect(await noms('/api/companies?hasType=hr,recruitment')).toEqual(['Acme']);
    expect(await noms('/api/companies?hasType=generic')).toEqual(['Boulangerie Martin']);
  });

  it('propose les valeurs connues des filtres', async () => {
    const reponse = await request(app).get('/api/companies/facets');
    // Une ville par orthographe, quelle que soit la casse.
    expect((reponse.body.cities as string[]).map((v) => v.toLowerCase())).toEqual([
      'lyon',
      'paris',
    ]);
    expect(reponse.body).toMatchObject({
      countries: [],
      industries: ['Commerce', 'Industrie'],
      tags: ['salon'],
    });
  });

  it('ne montre pas les entreprises d un autre compte', async () => {
    const autre = await createUser();
    await entreprise('Secrete', {}, [], autre);
    const reponse = await request(app).get('/api/companies?q=secrete');
    expect(reponse.body.total).toBe(0);
  });
});

describe('fiche entreprise (F-1004, F-307)', () => {
  it('rend l identite, les adresses par type avec toutes leurs sources, et l historique', async () => {
    const id = await entreprise('Acme', { domain: 'acme.fr', city: 'Lyon' }, [
      ['contact@acme.fr', 'generic', 'unverified'],
      ['jobs@acme.fr', 'recruitment', 'valid'],
    ]);
    await query(
      `insert into email_sources (email_id, kind, url, extraction_method)
       select id, 'website', 'https://acme.fr/carrieres', 'mailto' from emails where address = 'jobs@acme.fr'`,
    );
    const importe = await query<{ id: string }>(
      `insert into imports (user_id, filename) values ($1, 'salon.csv') returning id`,
      [userId],
    );
    await query(
      `insert into pipeline_jobs (import_id, company_id, step, status) values ($1, $2, 'crawl', 'done')`,
      [importe.rows[0]?.id, id],
    );

    const { get } = await agentAvecJeton();
    const reponse = await get(`/api/companies/${id}`);
    expect(reponse.status).toBe(200);
    expect(reponse.body.company).toMatchObject({ name: 'Acme', domain: 'acme.fr', city: 'Lyon' });
    const adresses = reponse.body.emails as { address: string; sources: { kind: string }[] }[];
    expect(adresses.map((e) => e.address)).toEqual(['jobs@acme.fr', 'contact@acme.fr']);
    expect(adresses[0]?.sources.map((s) => s.kind)).toEqual(['deduction', 'website']);
    expect(reponse.body.history).toMatchObject([
      { filename: 'salon.csv', step: 'crawl', status: 'done' },
    ]);
  });

  it('enregistre les notes et les etiquettes', async () => {
    const id = await entreprise('Acme', { domain: 'acme.fr' });
    const { patch } = await agentAvecJeton();
    const reponse = await patch(`/api/companies/${id}`, {
      notes: 'Rappeler en janvier.',
      tags: ['Salon', 'salon', 'Lyon'],
    });
    expect(reponse.status).toBe(200);
    expect(reponse.body.company).toMatchObject({
      notes: 'Rappeler en janvier.',
      tags: ['salon', 'lyon'],
    });
  });

  it('corrige le domaine et relance la collecte sur le bon site, avec sa trace', async () => {
    const id = await entreprise('Acme', { domain: 'acme-mauvais.fr' });
    const { post } = await agentAvecJeton();
    const reponse = await post(`/api/companies/${id}/domain`, {
      domain: 'https://www.Acme.fr/contact',
    });

    expect(reponse.status).toBe(202);
    expect(reponse.body.company).toMatchObject({
      domain: 'acme.fr',
      domainStatus: 'confirmed',
      crawlStatus: 'pending',
    });
    expect(file).toEqual([{ step: 'crawl', companyId: id, importId: reponse.body.importId }]);
    const importe = await query<{ filename: string; status: string }>(
      'select filename, status::text as status from imports where id = $1',
      [reponse.body.importId],
    );
    expect(importe.rows[0]).toEqual({
      filename: 'Correction du domaine : Acme',
      status: 'running',
    });
    const etapes = await query<{ step: string; status: string }>(
      'select step::text as step, status::text as status from pipeline_jobs where company_id = $1',
      [id],
    );
    expect(etapes.rows).toEqual([{ step: 'crawl', status: 'pending' }]);
  });

  it('refuse un domaine deja porte par une autre entreprise, et propose la fusion', async () => {
    await entreprise('Acme', { domain: 'acme.fr' });
    const doublon = await entreprise('Acme SAS', {});
    const { post } = await agentAvecJeton();
    const reponse = await post(`/api/companies/${doublon}/domain`, { domain: 'acme.fr' });
    expect(reponse.status).toBe(409);
    expect(reponse.body).toMatchObject({ code: 'domain_taken' });
    expect(file).toEqual([]);
  });

  it('ne montre ni ne modifie l entreprise d un autre compte', async () => {
    const autre = await createUser();
    const id = await entreprise('Secrete', { domain: 'secret.fr' }, [], autre);
    const { get, patch, post } = await agentAvecJeton();
    expect((await get(`/api/companies/${id}`)).status).toBe(404);
    expect((await patch(`/api/companies/${id}`, { notes: 'x' })).status).toBe(404);
    expect((await post(`/api/companies/${id}/domain`, { domain: 'x.fr' })).status).toBe(404);
    expect((await get('/api/companies/pas-un-uuid')).status).toBe(404);
  });
});
