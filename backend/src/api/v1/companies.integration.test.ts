import type { Express } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiKey } from '../../api-keys/repository.js';
import { closePool, query } from '../../db/pool.js';
import type { CompanyJob, CompanyStep } from '../../queue/queues.js';
import { createUser, resetData } from '../../test/integration/db.js';
import { createTestSession } from '../../test/session.js';
import { createMemoryRateLimitStore } from '../rate-limit.js';

vi.mock('../../queue/queues.js', () => ({
  enqueueImportPlan: vi.fn(() => Promise.resolve()),
  enqueueCompanyStep: vi.fn(() => Promise.resolve()),
  enqueueExportBuild: vi.fn(() => Promise.resolve()),
  enqueueCampaignMailerPush: vi.fn(() => Promise.resolve()),
}));
const { enqueueImportPlan } = await import('../../queue/queues.js');

let app: Express;
let userId: string;
let secret: string;
const file: { step: CompanyStep; job: CompanyJob }[] = [];

beforeAll(async () => {
  const { createApp } = await import('../../app.js');
  app = createApp({
    logger: pino({ level: 'silent' }),
    session: createTestSession(),
    enqueue: (step, job) => {
      file.push({ step, job });
      return Promise.resolve();
    },
    v1: { rateLimitStore: createMemoryRateLimitStore() },
  });
});

beforeEach(async () => {
  await resetData();
  await query('truncate idempotency_keys');
  vi.mocked(enqueueImportPlan).mockClear();
  file.length = 0;
  userId = await createUser();
  const cle = await createApiKey(userId, 'essai', ['companies:read', 'companies:write']);
  if (cle.kind !== 'created') throw new Error('cle attendue');
  secret = cle.secret;
});

afterAll(async () => {
  await closePool();
});

const avecCle = (r: request.Test) => r.set('authorization', `Bearer ${secret}`);
const api = {
  get: (c: string) => avecCle(request(app).get(`/v1${c}`)),
  post: (c: string) => avecCle(request(app).post(`/v1${c}`)),
  patch: (c: string) => avecCle(request(app).patch(`/v1${c}`)),
  delete: (c: string) => avecCle(request(app).delete(`/v1${c}`)),
};

async function creer(corps: object) {
  const reponse = await api.post('/companies').send(corps);
  expect([200, 201], JSON.stringify(reponse.body)).toContain(reponse.status);
  return reponse.body.company as { id: string; domain: string | null };
}

async function adresse(companyId: string, locale: string) {
  await query(
    `with e as (
       insert into emails (company_id, user_id, address, normalized_address, local_part, type, origin)
       select $1, $2, $3 || '@' || domain, $3 || '@' || domain, $3, 'generic', 'found'
         from companies where id = $1
       returning id
     )
     insert into email_sources (email_id, kind, url, extraction_method)
     select id, 'website', 'https://exemple.test/contact', 'mailto' from e`,
    [companyId, userId, locale],
  );
}

describe('POST /v1/companies', () => {
  it('cree l entreprise par un import d une ligne, et lance sa collecte', async () => {
    const reponse = await api
      .post('/companies')
      .send({ company_name: 'Alan', domain: 'https://www.Alan.com/', tags: ['Sante', 'Paris'] });
    expect(reponse.status).toBe(201);
    expect(reponse.body.created).toBe(true);
    expect(reponse.body.company).toMatchObject({
      name: 'Alan',
      domain: 'alan.com',
      tags: ['sante', 'paris'],
      emails: [],
    });
    expect(enqueueImportPlan).toHaveBeenCalledWith({ importId: reponse.body.import_id, userId });
  });

  it('rend l entreprise existante en 200 quand elle est deja dans la bibliotheque (F-303)', async () => {
    const premiere = await creer({ domain: 'alan.com' });
    const seconde = await api
      .post('/companies')
      .send({ company_name: 'Alan SAS', domain: 'alan.com' });
    expect(seconde.status).toBe(200);
    expect(seconde.body.created).toBe(false);
    expect(seconde.body.company.id).toBe(premiere.id);
  });

  it('refuse un champ inconnu, et une entreprise sans rien pour la trouver', async () => {
    const inconnu = await api.post('/companies').send({ domain: 'a.fr', chiffre: '10M' });
    expect(inconnu.status).toBe(400);
    expect(inconnu.body.code).toBe('invalid_company');
    const vide = await api.post('/companies').send({ city: 'Lyon' });
    expect(vide.status).toBe(400);
    expect(vide.body.code).toBe('no_usable_row');
  });

  it('demande la portee companies:write', async () => {
    const lecture = await createApiKey(userId, 'lecture', ['companies:read']);
    if (lecture.kind !== 'created') throw new Error('cle attendue');
    const reponse = await request(app)
      .post('/v1/companies')
      .set('authorization', `Bearer ${lecture.secret}`)
      .send({ domain: 'alan.com' });
    expect(reponse.status).toBe(403);
  });
});

describe('GET /v1/companies', () => {
  it('filtre et pagine par curseur, avec le nombre d adresses', async () => {
    const alan = await creer({
      company_name: 'Alan',
      domain: 'alan.com',
      city: 'Paris',
      tags: ['sante'],
    });
    await creer({ company_name: 'Qonto', domain: 'qonto.com', city: 'Paris' });
    await creer({ company_name: 'Boulangerie Martin', domain: 'martin.fr', city: 'Lyon' });
    await adresse(alan.id, 'contact');

    const page1 = await api.get('/companies?limit=2');
    expect(page1.body.data).toHaveLength(2);
    const page2 = await api.get(`/companies?limit=2&cursor=${page1.body.next_cursor as string}`);
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.next_cursor).toBeNull();

    const noms = async (filtre: string) =>
      ((await api.get(`/companies?${filtre}`)).body.data as { name: string }[])
        .map((c) => c.name)
        .sort();
    expect(await noms('city=paris')).toEqual(['Alan', 'Qonto']);
    expect(await noms('tag=SANTE')).toEqual(['Alan']);
    expect(await noms('q=boulang')).toEqual(['Boulangerie Martin']);
    expect(await noms('domain=qonto.com')).toEqual(['Qonto']);
    expect(await noms('q=%25')).toEqual([]);

    const avecAdresse = (await api.get('/companies?domain=alan.com')).body.data[0];
    expect(avecAdresse.emails_count).toBe(1);
  });

  it('refuse un filtre inconnu de statut de collecte', async () => {
    const reponse = await api.get('/companies?crawl_status=bientot');
    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('invalid_filter');
  });
});

describe('GET, PATCH et DELETE /v1/companies/{id}', () => {
  it('rend le detail avec les adresses et leurs sources, jamais celui d un autre compte', async () => {
    const alan = await creer({ domain: 'alan.com' });
    await adresse(alan.id, 'rh');
    const reponse = await api.get(`/companies/${alan.id}`);
    expect(reponse.body.company.emails).toEqual([
      expect.objectContaining({
        address: 'rh@alan.com',
        sources: [expect.objectContaining({ kind: 'website' })],
      }),
    ]);

    const autre = await createUser();
    const sienne = await createApiKey(autre, 'autre', ['companies:read']);
    if (sienne.kind !== 'created') throw new Error('cle attendue');
    const refus = await request(app)
      .get(`/v1/companies/${alan.id}`)
      .set('authorization', `Bearer ${sienne.secret}`);
    expect(refus.status).toBe(404);
  });

  it('modifie le nom et les etiquettes, et refuse une modification vide', async () => {
    const alan = await creer({ domain: 'alan.com' });
    const modifiee = await api
      .patch(`/companies/${alan.id}`)
      .send({ name: 'Alan', tags: ['Client'] });
    expect(modifiee.status).toBe(200);
    expect(modifiee.body.company).toMatchObject({ name: 'Alan', tags: ['client'] });
    expect((await api.patch(`/companies/${alan.id}`).send({})).status).toBe(400);
    expect((await api.patch(`/companies/${alan.id}`).send({ domain: 'x.fr' })).status).toBe(400);
  });

  it('supprime l entreprise et ses adresses, et peut les ajouter a la liste de suppression (R-05)', async () => {
    const alan = await creer({ domain: 'alan.com' });
    await adresse(alan.id, 'contact');
    const reponse = await api.delete(`/companies/${alan.id}?suppress=true`);
    expect(reponse.body).toEqual({ deleted: true, suppressed: 1 });
    const restes = await query<{ n: number }>('select count(*)::int as n from emails');
    expect(restes.rows[0]?.n).toBe(0);
    expect((await api.get(`/companies/${alan.id}`)).status).toBe(404);
  });
});

describe('POST /v1/companies/{id}/enrich', () => {
  it('relance la collecte sur le domaine actuel', async () => {
    const alan = await creer({ domain: 'alan.com' });
    const reponse = await api.post(`/companies/${alan.id}/enrich`).send({});
    expect(reponse.status).toBe(202);
    expect(reponse.body.import_id).toEqual(expect.any(String));
    expect(file.map((f) => f.step)).toContain('crawl');
  });

  it('refuse une entreprise sans domaine', async () => {
    const sans = await creer({ company_name: 'Boulangerie Martin', city: 'Lyon' });
    const reponse = await api.post(`/companies/${sans.id}/enrich`).send({});
    expect(reponse.status).toBe(409);
    expect(reponse.body.code).toBe('domain_required');
  });
});
