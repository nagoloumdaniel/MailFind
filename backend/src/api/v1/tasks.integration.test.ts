import type { Express } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiKey } from '../../api-keys/repository.js';
import { closePool, query } from '../../db/pool.js';
import { createMemoryStorage } from '../../exports/storage.js';
import { runExportJob } from '../../exports/service.js';
import { createUser, resetData } from '../../test/integration/db.js';
import { createTestSession } from '../../test/session.js';
import type { MailDns } from '../../verification/local.js';
import { purgeExpiredVerificationRuns, runVerification } from '../../verification/runs.js';
import { createMemoryRateLimitStore } from '../rate-limit.js';

vi.mock('../../queue/queues.js', () => ({
  enqueueImportPlan: vi.fn(() => Promise.resolve()),
  enqueueCompanyStep: vi.fn(() => Promise.resolve()),
  enqueueExportBuild: vi.fn(() => Promise.resolve()),
  enqueueVerificationRun: vi.fn(() => Promise.resolve()),
}));
const { enqueueImportPlan, enqueueVerificationRun } = await import('../../queue/queues.js');

/** acme.fr recoit du courrier ; le reste n'existe pas. */
const DNS: MailDns = {
  mx: (domaine) =>
    domaine === 'acme.fr'
      ? Promise.resolve([{ exchange: 'mx.acme.fr', priority: 10 }])
      : Promise.reject(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })),
  hasAddress: () => Promise.resolve(false),
};

const stockage = createMemoryStorage();
const exportsEnFile: string[] = [];
let app: Express;
let userId: string;
let secret: string;

beforeAll(async () => {
  const { createApp } = await import('../../app.js');
  app = createApp({
    logger: pino({ level: 'silent' }),
    session: createTestSession(),
    exportStorage: stockage,
    enqueueExport: (id) => {
      exportsEnFile.push(id);
      return Promise.resolve();
    },
    v1: { rateLimitStore: createMemoryRateLimitStore(), dns: DNS },
  });
});

beforeEach(async () => {
  await resetData();
  await query('truncate idempotency_keys, verification_runs, exports');
  vi.mocked(enqueueImportPlan).mockClear();
  vi.mocked(enqueueVerificationRun).mockClear();
  exportsEnFile.length = 0;
  userId = await createUser();
  const cle = await createApiKey(userId, 'essai', ['imports:write', 'verify', 'exports:write']);
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
};

async function entrepriseExploree(domaine: string): Promise<string> {
  const lignes = await query<{ id: string }>(
    `insert into companies (user_id, name, normalized_name, domain, domain_status, crawl_status,
                            contact_form_url)
     values ($1, $2, $2, $2, 'provided', 'done', 'https://' || $2 || '/contact') returning id`,
    [userId, domaine],
  );
  const id = lignes.rows[0]?.id ?? '';
  await query(
    `with e as (
       insert into emails (company_id, user_id, address, normalized_address, local_part, type,
                           origin, status, score)
       values ($1, $2, 'recrutement@' || $3, 'recrutement@' || $3, 'recrutement', 'recruitment',
               'found', 'valid', 90)
       returning id
     )
     insert into email_sources (email_id, kind, url, extraction_method)
     select id, 'website', 'https://' || $3 || '/carrieres', 'mailto' from e`,
    [id, userId, domaine],
  );
  return id;
}

describe('POST /v1/find (annexe C)', () => {
  it('rend tout de suite une entreprise deja exploree, sans rien lancer', async () => {
    const id = await entrepriseExploree('acme.fr');
    const reponse = await api.post('/find').send({ url: 'https://www.acme.fr/equipe' });
    expect(reponse.status).toBe(200);
    expect(reponse.body).toMatchObject({
      company: { id, domain: 'acme.fr' },
      emails: [
        {
          address: 'recrutement@acme.fr',
          type: 'recruitment',
          origin: 'found',
          status: 'valid',
          score: 90,
          sources: [{ kind: 'website', url: 'https://acme.fr/carrieres' }],
        },
      ],
      alternatives: { contact_form_url: 'https://acme.fr/contact' },
      cached: true,
    });
    expect(enqueueImportPlan).not.toHaveBeenCalled();
  });

  it('lance la recherche d une entreprise inconnue et rend l import a suivre', async () => {
    const reponse = await api.post('/find').send({ name: 'Globex', domain: 'globex.fr' });
    expect(reponse.status).toBe(202);
    expect(reponse.body).toMatchObject({
      status: 'pending',
      import_id: expect.any(String),
      company_id: expect.any(String),
    });
    expect(enqueueImportPlan).toHaveBeenCalledWith({ importId: reponse.body.import_id, userId });
  });

  it('refuse une recherche sans nom, domaine ni URL', async () => {
    const reponse = await api.post('/find').send({ city: 'Lyon' });
    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('invalid_find');
  });
});

describe('POST /v1/verify et GET /v1/verifications/{id}', () => {
  it('verifie jusqu a 100 adresses dans la reponse, sans jamais dire valide', async () => {
    const reponse = await api
      .post('/verify')
      .send({ addresses: ['rh@acme.fr', 'pas-une-adresse', 'contact@inconnu.test'] });
    expect(reponse.status).toBe(200);
    const resultats = reponse.body.results as { status: string }[];
    expect(resultats.map((r) => r.status)).toEqual(['unverified', 'invalid', 'invalid']);
  });

  it('au-dela de 100, part en tache, puis rend le resultat', async () => {
    const adresses = Array.from({ length: 150 }, (_, i) => `contact${String(i)}@acme.fr`);
    const creee = await api.post('/verify').send({ addresses: adresses });
    expect(creee.status).toBe(202);
    const id = creee.body.verification.id as string;
    expect(creee.body.verification).toMatchObject({ status: 'pending', total: 150 });
    expect(enqueueVerificationRun).toHaveBeenCalledWith(id);

    const enCours = await api.get(`/verifications/${id}`);
    expect(enCours.body.results).toBeNull();

    await runVerification(id, DNS);
    const faite = await api.get(`/verifications/${id}`);
    expect(faite.body.verification.status).toBe('done');
    expect(faite.body.results).toHaveLength(150);

    await query(`update verification_runs set created_at = now() - interval '8 days'`);
    expect(await purgeExpiredVerificationRuns()).toBe(1);
    expect((await api.get(`/verifications/${id}`)).status).toBe(404);
  });

  it('refuse plus de 10 000 adresses', async () => {
    const adresses = Array.from({ length: 10_001 }, (_, i) => `a${String(i)}@acme.fr`);
    const reponse = await api.post('/verify').send({ addresses: adresses });
    expect(reponse.status).toBe(400);
  });
});

describe('POST /v1/exports et GET /v1/exports/{id}', () => {
  it('produit l export en tache et le rend par son lien jusqu a expiration', async () => {
    await entrepriseExploree('acme.fr');
    const cree = await api.post('/exports').send({ format: 'csv_emails', statuses: 'valid' });
    expect(cree.status).toBe(202);
    const id = cree.body.export.id as string;
    expect(cree.body.export).toMatchObject({ status: 'pending', download_url: null });
    expect(exportsEnFile).toEqual([id]);

    await runExportJob(stockage, id);
    const pret = await api.get(`/exports/${id}`);
    expect(pret.body.export).toMatchObject({ status: 'done', row_count: 1 });
    expect(pret.body.export.download_url).toBe(`/v1/exports/${id}/download`);

    const fichier = await api.get(`/exports/${id}/download`);
    expect(fichier.status).toBe(200);
    expect(fichier.text).toContain('recrutement@acme.fr');
  });

  it('traduit un perimetre d adresses et refuse un format inconnu', async () => {
    const refus = await api.post('/exports').send({ format: 'pdf' });
    expect(refus.status).toBe(400);
    const adresses = await api.post('/exports').send({
      format: 'json',
      scope: { kind: 'emails', ids: ['01a0ede9-57d4-71e3-b0c4-d359a183d46b'] },
    });
    expect(adresses.status).toBe(202);
  });
});
