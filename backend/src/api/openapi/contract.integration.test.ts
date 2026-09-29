import type { Express } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApiKey } from '../../api-keys/repository.js';
import { API_SCOPES } from '../../api-keys/keys.js';
import { closePool, query } from '../../db/pool.js';
import { runExportJob } from '../../exports/service.js';
import { createMemoryStorage } from '../../exports/storage.js';
import { planImport } from '../../imports/plan.js';
import { createUser, resetData } from '../../test/integration/db.js';
import { createTestSession } from '../../test/session.js';
import type { MailDns } from '../../verification/local.js';
import { runVerification } from '../../verification/runs.js';
import { createMemoryRateLimitStore } from '../rate-limit.js';
import { OPERATIONS, type Operation } from './document.js';
import { problemSchema } from './responses.js';

/**
 * Tests de contrat (A8) : chaque operation du document est appelee sur une
 * vraie base, et sa reponse est validee par le schema de sa ligne dans le
 * document. Une operation jamais appelee fait echouer le dernier test.
 */

vi.mock('../../queue/queues.js', () => ({
  enqueueImportPlan: vi.fn(() => Promise.resolve()),
  enqueueCompanyStep: vi.fn(() => Promise.resolve()),
  enqueueExportBuild: vi.fn(() => Promise.resolve()),
  enqueueVerificationRun: vi.fn(() => Promise.resolve()),
}));

const DNS: MailDns = {
  mx: (domaine) =>
    domaine === 'alan.com'
      ? Promise.resolve([{ exchange: 'mx.alan.com', priority: 10 }])
      : Promise.reject(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })),
  hasAddress: () => Promise.resolve(false),
};

const stockage = createMemoryStorage();
const couvertes = new Set<string>();
let app: Express;
let userId: string;
let secret: string;

beforeAll(async () => {
  const { createApp } = await import('../../app.js');
  app = createApp({
    logger: pino({ level: 'silent' }),
    session: createTestSession(),
    exportStorage: stockage,
    enqueue: () => Promise.resolve(),
    enqueueExport: () => Promise.resolve(),
    v1: { rateLimitStore: createMemoryRateLimitStore(), dns: DNS },
  });
  await resetData();
  await query('truncate idempotency_keys, verification_runs, exports, provider_calls');
  userId = await createUser();
  const cle = await createApiKey(userId, 'contrat', [...API_SCOPES]);
  if (cle.kind !== 'created') throw new Error('cle attendue');
  secret = cle.secret;
});

afterAll(async () => {
  await closePool();
});

/** Appelle une operation du document et valide la reponse avec le schema de son statut. */
async function appeler(
  methode: Operation['method'],
  gabarit: string,
  options: { id?: string; query?: string; body?: object } = {},
): Promise<request.Response> {
  const operation = OPERATIONS.find((o) => o.method === methode && o.path === gabarit);
  if (operation === undefined) throw new Error(`${methode} ${gabarit} absent du document`);
  const chemin = `/v1${gabarit.replace('{id}', options.id ?? '')}${options.query ?? ''}`;
  let envoi = request(app)[methode](chemin).set('authorization', `Bearer ${secret}`);
  if (options.body !== undefined) envoi = envoi.send(options.body);
  const reponse = await envoi;

  const attendue = operation.responses[reponse.status];
  if (reponse.status >= 400) {
    const lu = problemSchema.safeParse(reponse.body);
    expect(
      lu.success,
      `${methode} ${gabarit} ${String(reponse.status)} : ${JSON.stringify(lu.error?.issues)}`,
    ).toBe(true);
    expect(reponse.headers['content-type']).toMatch(/application\/problem\+json/);
  } else {
    expect(
      attendue,
      `${methode} ${gabarit} : statut ${String(reponse.status)} non documente`,
    ).toBeDefined();
    if (attendue?.schema !== undefined) {
      const lu = attendue.schema.safeParse(reponse.body);
      expect(
        lu.success,
        `${methode} ${gabarit} ${String(reponse.status)} : ${JSON.stringify(lu.error?.issues)}`,
      ).toBe(true);
    }
    couvertes.add(`${methode} ${gabarit}`);
  }
  return reponse;
}

describe('l API repond conformement a son document (A8)', () => {
  let importId = '';
  let alan = '';
  let emailId = '';

  it('imports', async () => {
    const cree = await appeler('post', '/imports', {
      body: {
        companies: [
          { company_name: 'Alan', domain: 'alan.com' },
          { company_name: 'Qonto', domain: 'qonto.com' },
        ],
      },
    });
    expect(cree.status).toBe(201);
    importId = cree.body.import.id as string;
    await planImport(importId, userId);
    await appeler('get', '/imports/{id}', { id: importId });

    const entreprise = await query<{ id: string }>(
      `select id from companies where domain = 'alan.com'`,
    );
    alan = entreprise.rows[0]?.id ?? '';
    await query(
      `update companies set crawl_status = 'done', contact_form_url = 'https://alan.com/contact'
        where id = $1`,
      [alan],
    );
    const email = await query<{ id: string }>(
      `with e as (
         insert into emails (company_id, user_id, address, normalized_address, local_part, type,
                             origin, status, score, last_verified_at)
         values ($1, $2, 'contact@alan.com', 'contact@alan.com', 'contact', 'generic', 'found',
                 'valid', 90, now())
         returning id
       ), s as (
         insert into email_sources (email_id, kind, url, extraction_method)
         select id, 'website', 'https://alan.com/contact', 'mailto' from e
       )
       select id from e`,
      [alan, userId],
    );
    emailId = email.rows[0]?.id ?? '';
    const resultats = await appeler('get', '/imports/{id}/results', {
      id: importId,
      query: '?limit=1',
    });
    expect(resultats.body.data.length).toBeGreaterThan(0);

    const aAnnuler = await appeler('post', '/imports', { body: { csv: 'domain\nglobex.fr\n' } });
    const id = aAnnuler.body.import.id as string;
    expect((await appeler('post', '/imports/{id}/cancel', { id })).status).toBe(200);
    expect((await appeler('post', '/imports/{id}/cancel', { id })).status).toBe(409);
  });

  it('recherche', async () => {
    expect((await appeler('post', '/find', { body: { domain: 'alan.com' } })).status).toBe(200);
    expect((await appeler('post', '/find', { body: { domain: 'initech.fr' } })).status).toBe(202);
  });

  it('entreprises', async () => {
    const liste = await appeler('get', '/companies', { query: '?limit=10' });
    // Une liste vide ne validerait aucun element : le contrat ne prouverait rien.
    expect(liste.body.data.length).toBeGreaterThan(0);
    expect((await appeler('post', '/companies', { body: { domain: 'alan.com' } })).status).toBe(
      200,
    );
    const creee = await appeler('post', '/companies', { body: { domain: 'hooli.com' } });
    expect(creee.status).toBe(201);
    await appeler('get', '/companies/{id}', { id: alan });
    await appeler('patch', '/companies/{id}', { id: alan, body: { tags: ['client'] } });
    expect((await appeler('post', '/companies/{id}/enrich', { id: alan })).status).toBe(202);
    const sans = await appeler('post', '/companies', {
      body: { company_name: 'Sans Domaine', city: 'Lyon' },
    });
    const refus = await appeler('post', '/companies/{id}/enrich', {
      id: sans.body.company.id as string,
    });
    expect(refus.status).toBe(409);
    expect((await appeler('get', '/companies/{id}', { id: 'pas-un-uuid' })).status).toBe(404);
    await appeler('delete', '/companies/{id}', { id: creee.body.company.id as string });
  });

  it('adresses', async () => {
    const adresses = await appeler('get', '/emails', { query: '?status=valid' });
    expect(adresses.body.data.length).toBeGreaterThan(0);
    await appeler('patch', '/emails/{id}', { id: emailId, body: { tags: ['salon'] } });
  });

  it('verification', async () => {
    await appeler('post', '/verify', { body: { addresses: ['contact@alan.com', 'faux'] } });
    const tache = await appeler('post', '/verify', {
      body: { addresses: Array.from({ length: 101 }, (_, i) => `a${String(i)}@alan.com`) },
    });
    expect(tache.status).toBe(202);
    const id = tache.body.verification.id as string;
    await appeler('get', '/verifications/{id}', { id });
    await runVerification(id, DNS);
    await appeler('get', '/verifications/{id}', { id });
  });

  it('exports', async () => {
    const cree = await appeler('post', '/exports', { body: { format: 'csv_emails' } });
    const id = cree.body.export.id as string;
    await runExportJob(stockage, id);
    await appeler('get', '/exports/{id}', { id });
    expect((await appeler('get', '/exports/{id}/download', { id })).status).toBe(200);
  });

  it('consommation, suppression et erreurs', async () => {
    await appeler('get', '/usage');
    expect((await appeler('post', '/imports', { body: {} })).status).toBe(400);
    await appeler('delete', '/emails/{id}', { id: emailId });
  });

  it('a appele chaque operation du document au moins une fois avec succes', () => {
    const manquantes = OPERATIONS.map((o) => `${o.method} ${o.path}`).filter(
      (o) => !couvertes.has(o),
    );
    expect(manquantes).toEqual([]);
  });
});
