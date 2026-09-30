import type { Express } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiKey } from '../../api-keys/repository.js';
import { closePool, query } from '../../db/pool.js';
import { planImport } from '../../imports/plan.js';
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

beforeAll(async () => {
  const { createApp } = await import('../../app.js');
  app = createApp({
    logger: pino({ level: 'silent' }),
    session: createTestSession(),
    v1: { rateLimitStore: createMemoryRateLimitStore() },
  });
});

beforeEach(async () => {
  await resetData();
  await query('truncate idempotency_keys, provider_calls');
  vi.mocked(enqueueImportPlan).mockClear();
  userId = await createUser();
  const cle = await createApiKey(userId, 'essai', ['imports:write', 'companies:read']);
  if (cle.kind !== 'created') throw new Error('cle attendue');
  secret = cle.secret;
});

afterAll(async () => {
  await closePool();
});

const api = () => ({
  get: (chemin: string) =>
    request(app).get(`/v1${chemin}`).set('authorization', `Bearer ${secret}`),
  post: (chemin: string) =>
    request(app).post(`/v1${chemin}`).set('authorization', `Bearer ${secret}`),
});

async function importer(
  corps: object = { companies: [{ company_name: 'Alan', domain: 'alan.com' }] },
) {
  const reponse = await api().post('/imports').send(corps);
  expect(reponse.status, JSON.stringify(reponse.body)).toBe(201);
  return reponse.body.import.id as string;
}

describe('POST /v1/imports (F-207)', () => {
  it('cree un import depuis des lignes JSON, avec les reglages en snake_case, et le lance', async () => {
    const reponse = await api()
      .post('/imports')
      .send({
        name: 'crm.json',
        companies: [
          { company_name: 'Alan', domain: 'alan.com', tags: ['salon', 'Lyon'], effectif: 500 },
          { city: 'Lyon' },
        ],
        settings: { depth: 'quick', email_types: ['recruitment'], mailbox_check: 'found' },
      });

    expect(reponse.status).toBe(201);
    expect(reponse.body.import).toMatchObject({
      name: 'crm.json',
      total_rows: 2,
      accepted_rows: 1,
      rejected_rows: 1,
    });
    expect(enqueueImportPlan).toHaveBeenCalledWith({ importId: reponse.body.import.id, userId });

    const enregistre = await query<{ settings: Record<string, unknown>; raw: unknown }>(
      `select i.settings, r.raw from imports i join import_rows r on r.import_id = i.id
        where i.id = $1 and r.line = 2`,
      [reponse.body.import.id],
    );
    expect(enregistre.rows[0]?.settings).toMatchObject({
      depth: 'quick',
      emailTypes: ['recruitment'],
      mailboxCheck: 'found',
    });
    // Une cle inconnue reste une colonne libre, comme dans un fichier.
    expect(enregistre.rows[0]?.raw).toMatchObject({ effectif: '500', tags: 'salon, Lyon' });
  });

  it('cree un import depuis un CSV a point-virgule dont l en-tete nomme les champs', async () => {
    const id = await importer({
      csv: 'company_name;Domain;Chiffre\nAlan;alan.com;10M\nQonto;qonto.com;\n',
    });
    const lignes = await query<{ n: number }>(
      `select count(*)::int as n from import_rows where import_id = $1 and status = 'accepted'`,
      [id],
    );
    expect(lignes.rows[0]?.n).toBe(2);
  });

  it('refuse companies et csv ensemble ou absents, des reglages faux, et un fichier sans ligne utile', async () => {
    for (const [corps, code] of [
      [{}, 'invalid_import'],
      [{ companies: [{ domain: 'a.fr' }], csv: 'domain\na.fr' }, 'invalid_import'],
      [{ companies: [{ domain: 'a.fr' }], settings: { depth: 'infinie' } }, 'invalid_import'],
      [{ companies: [{ domain: 'a.fr' }], settings: { email_types: [] } }, 'invalid_settings'],
      [{ companies: [{ city: 'Lyon' }] }, 'no_usable_row'],
    ] as const) {
      const reponse = await api().post('/imports').send(corps);
      expect(reponse.status, JSON.stringify(corps)).toBe(400);
      expect(reponse.body.code, JSON.stringify(corps)).toBe(code);
    }
    expect(enqueueImportPlan).not.toHaveBeenCalled();
  });

  it('accepte 5 000 lignes au-dela d un megaoctet', async () => {
    const companies = Array.from({ length: 5000 }, (_, i) => ({
      company_name: `Entreprise ${String(i)}`,
      domain: `entreprise-${String(i)}.fr`,
      notes: 'x'.repeat(200),
    }));
    const reponse = await api().post('/imports').send({ companies });
    expect(reponse.status).toBe(201);
    expect(reponse.body.import.total_rows).toBe(5000);
  });

  it('ne cree qu un import sous la meme Idempotency-Key (F-1305)', async () => {
    const corps = { companies: [{ domain: 'alan.com' }] };
    const une = await api().post('/imports').set('idempotency-key', 'k1').send(corps);
    const deux = await api().post('/imports').set('idempotency-key', 'k1').send(corps);
    expect(deux.body.import.id).toBe(une.body.import.id);
    const n = await query<{ n: number }>('select count(*)::int as n from imports');
    expect(n.rows[0]?.n).toBe(1);
  });

  it('demande la portee imports:write', async () => {
    const lecture = await createApiKey(userId, 'lecture', ['companies:read']);
    if (lecture.kind !== 'created') throw new Error('cle attendue');
    const reponse = await request(app)
      .post('/v1/imports')
      .set('authorization', `Bearer ${lecture.secret}`)
      .send({ companies: [{ domain: 'alan.com' }] });
    expect(reponse.status).toBe(403);
  });
});

describe('GET /v1/imports/{id} et ses resultats', () => {
  it('rend le statut, la progression et les lignes refusees', async () => {
    const id = await importer({ companies: [{ domain: 'alan.com' }, { city: 'Lyon' }] });
    const reponse = await api().get(`/imports/${id}`);
    expect(reponse.status).toBe(200);
    expect(reponse.body.import).toMatchObject({ id, status: 'pending', total_rows: 2 });
    expect(reponse.body.progress.steps).toHaveProperty('crawl');
    expect(reponse.body.rejected_rows).toEqual([expect.objectContaining({ line: 3 })]);
  });

  it('ne montre pas l import d un autre compte, ni un identifiant illisible', async () => {
    const autre = await createUser();
    const sienne = await createApiKey(autre, 'autre', ['imports:write']);
    if (sienne.kind !== 'created') throw new Error('cle attendue');
    const creation = await request(app)
      .post('/v1/imports')
      .set('authorization', `Bearer ${sienne.secret}`)
      .send({ companies: [{ domain: 'globex.com' }] });
    expect((await api().get(`/imports/${creation.body.import.id as string}`)).status).toBe(404);
    expect((await api().get('/imports/pas-un-uuid')).status).toBe(404);
  });

  it('rend les entreprises de l import avec leurs adresses et leurs sources, page par page', async () => {
    const id = await importer({
      companies: [
        { company_name: 'Alan', domain: 'alan.com' },
        { company_name: 'Qonto', domain: 'qonto.com' },
      ],
    });
    await planImport(id, userId);
    const alan = await query<{ id: string }>(`select id from companies where domain = 'alan.com'`);
    await query(
      `with e as (
         insert into emails (company_id, user_id, address, normalized_address, local_part, type, origin, status, score)
         values ($1, $2, 'contact@alan.com', 'contact@alan.com', 'contact', 'generic', 'found', 'valid', 90)
         returning id
       )
       insert into email_sources (email_id, kind, url, extraction_method)
       select id, 'website', 'https://alan.com/contact', 'mailto' from e`,
      [alan.rows[0]?.id, userId],
    );

    const premiere = await api().get(`/imports/${id}/results?limit=1`);
    expect(premiere.status).toBe(200);
    expect(premiere.body.data).toHaveLength(1);
    expect(premiere.body.next_cursor).toEqual(expect.any(String));
    const seconde = await api().get(
      `/imports/${id}/results?limit=1&cursor=${premiere.body.next_cursor as string}`,
    );
    expect(seconde.body.next_cursor).toBeNull();

    const toutes = [...premiere.body.data, ...seconde.body.data];
    expect(toutes.map((c: { domain: string }) => c.domain).sort()).toEqual([
      'alan.com',
      'qonto.com',
    ]);
    const avecAdresse = toutes.find((c: { domain: string }) => c.domain === 'alan.com');
    expect(avecAdresse.emails).toEqual([
      expect.objectContaining({
        address: 'contact@alan.com',
        status: 'valid',
        score: 90,
        sources: [expect.objectContaining({ kind: 'website', url: 'https://alan.com/contact' })],
      }),
    ]);
  });

  it('annule un import en cours, une seule fois', async () => {
    const id = await importer();
    const annule = await api().post(`/imports/${id}/cancel`).send({});
    expect(annule.status).toBe(200);
    expect(annule.body.import.status).toBe('cancelled');
    const encore = await api().post(`/imports/${id}/cancel`).send({});
    expect(encore.status).toBe(409);
    expect(encore.body.code).toBe('import_not_cancellable');
  });
});

describe('GET /v1/usage (F-1309)', () => {
  it('rend les compteurs du mois, ceux du tableau de bord', async () => {
    await query(
      `insert into provider_calls (user_id, provider, operation, idempotency_key, status, credits)
       values ($1, 'hunter', 'domain_search', 'k1', 'confirmed', 1)`,
      [userId],
    );
    const reponse = await api().get('/usage');
    expect(reponse.status).toBe(200);
    expect(reponse.body.period.start).toMatch(/-01T00:00:00.000Z$/);
    expect(reponse.body.meters).toContainEqual({
      provider: 'hunter',
      operation: 'domain_search',
      used: 1,
      limit: 3,
      remaining: 2,
    });
  });
});
