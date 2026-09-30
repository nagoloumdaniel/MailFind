import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiKey } from '../api-keys/repository.js';
import { createMemoryRateLimitStore } from '../api/rate-limit.js';
import { closePool, query } from '../db/pool.js';
import { createFetcher, type Fetcher } from '../net/safe-fetch.js';
import { completeImportIfDone } from '../pipeline/steps.js';
import { createCipher } from '../security/crypto.js';
import { createUser, resetData } from '../test/integration/db.js';
import { startTestSites, type TestSites } from '../test/sites/server.js';
import { createTestSession } from '../test/session.js';
import { deliverWebhook, emitWebhookEvent, MAX_WEBHOOKS } from './service.js';
import { verifyWebhookSignature } from './signature.js';

vi.mock('../queue/queues.js', () => ({
  enqueueImportPlan: vi.fn(() => Promise.resolve()),
  enqueueCompanyStep: vi.fn(() => Promise.resolve()),
  enqueueExportBuild: vi.fn(() => Promise.resolve()),
  enqueueCampaignMailerPush: vi.fn(() => Promise.resolve()),
  enqueueVerificationRun: vi.fn(() => Promise.resolve()),
  enqueueWebhookDelivery: vi.fn(() => Promise.resolve()),
}));
const { enqueueWebhookDelivery } = await import('../queue/queues.js');

const CHIFFREUR = createCipher(randomBytes(32).toString('hex'));
let app: Express;
let sites: TestSites;
let fetcher: Fetcher;
let userId: string;
let secret: string;

beforeAll(async () => {
  const { createApp } = await import('../app.js');
  app = createApp({
    logger: pino({ level: 'silent' }),
    session: createTestSession(),
    v1: { rateLimitStore: createMemoryRateLimitStore(), cipher: CHIFFREUR },
  });
  // hooks.test est servi en local : le client croit parler a https://hooks.test.
  sites = await startTestSites(['hooks.test']);
  fetcher = createFetcher({ testRouting: sites });
});

beforeEach(async () => {
  await resetData();
  await query('truncate idempotency_keys');
  vi.mocked(enqueueWebhookDelivery).mockClear();
  sites.requests.length = 0;
  userId = await createUser();
  const cle = await createApiKey(userId, 'essai', ['integrations:write']);
  if (cle.kind !== 'created') throw new Error('cle attendue');
  secret = cle.secret;
});

afterAll(async () => {
  await fetcher.close();
  await sites.close();
  await closePool();
});

const avecCle = (r: request.Test) => r.set('authorization', `Bearer ${secret}`);
const api = {
  get: (c: string) => avecCle(request(app).get(`/v1${c}`)),
  post: (c: string) => avecCle(request(app).post(`/v1${c}`)),
  delete: (c: string) => avecCle(request(app).delete(`/v1${c}`)),
};

async function abonner(chemin: string, events = ['import.completed']) {
  const reponse = await api.post('/webhooks').send({ url: `https://hooks.test${chemin}`, events });
  expect(reponse.status, JSON.stringify(reponse.body)).toBe(201);
  return { id: reponse.body.webhook.id as string, secret: reponse.body.secret as string };
}

async function livraison(): Promise<{
  id: string;
  status: string;
  attempts: number;
  last_status_code: number | null;
}> {
  const lignes = await query<{
    id: string;
    status: string;
    attempts: number;
    last_status_code: number | null;
  }>('select id, status::text as status, attempts, last_status_code from webhook_deliveries');
  const ligne = lignes.rows[0];
  if (ligne === undefined) throw new Error('livraison attendue');
  return ligne;
}

describe('abonnements (F-1308)', () => {
  it('rend le secret une seule fois, et ne le garde que chiffre', async () => {
    const reponse = await api
      .post('/webhooks')
      .set('idempotency-key', 'k1')
      .send({ url: 'https://hooks.test/recu', events: ['import.completed', 'export.ready'] });
    expect(reponse.status).toBe(201);
    expect(reponse.headers['cache-control']).toBe('no-store');
    const whsec = reponse.body.secret as string;
    expect(whsec).toMatch(/^whsec_/);
    expect(reponse.body.webhook).toMatchObject({ secret_prefix: whsec.slice(0, 12) });

    const enBase = await query<{ ligne: string }>(
      'select row_to_json(w)::text as ligne from webhooks w',
    );
    expect(enBase.rows[0]?.ligne).not.toContain(whsec.slice(12));
    // S-01 : la reponse qui porte le secret n'est pas gardee par l'idempotence.
    const gardees = await query<{ n: number }>('select count(*)::int as n from idempotency_keys');
    expect(gardees.rows[0]?.n).toBe(0);

    const liste = await api.get('/webhooks');
    expect(JSON.stringify(liste.body)).not.toContain(whsec.slice(12));
  });

  it('refuse une URL non https, locale ou privee, et un evenement inconnu', async () => {
    for (const corps of [
      { url: 'http://hooks.test/recu', events: ['import.completed'] },
      { url: 'https://127.0.0.1/recu', events: ['import.completed'] },
      { url: 'https://localhost/recu', events: ['import.completed'] },
      { url: 'https://169.254.169.254/recu', events: ['import.completed'] },
      { url: 'https://hooks.test/recu', events: ['user.deleted'] },
    ]) {
      const reponse = await api.post('/webhooks').send(corps);
      expect(reponse.status, JSON.stringify(corps)).toBe(400);
    }
  });

  it(`s arrete a ${String(MAX_WEBHOOKS)} abonnements`, async () => {
    for (let i = 0; i < MAX_WEBHOOKS; i += 1) await abonner(`/recu${String(i)}`);
    const refus = await api
      .post('/webhooks')
      .send({ url: 'https://hooks.test/x', events: ['export.ready'] });
    expect(refus.status).toBe(409);
  });

  it('supprime un abonnement, jamais celui d un autre compte', async () => {
    const { id } = await abonner('/recu');
    expect((await api.delete(`/webhooks/${id}`)).status).toBe(200);
    expect((await api.delete(`/webhooks/${id}`)).status).toBe(404);
    expect((await api.get('/webhooks')).body.webhooks).toEqual([]);
  });
});

describe('livraisons', () => {
  it('signe le corps exact, et le destinataire peut le verifier', async () => {
    const abonnement = await abonner('/__erreur?code=200');
    await emitWebhookEvent(userId, 'import.completed', { import_id: 'x', status: 'completed' });
    const { id } = await livraison();
    expect(enqueueWebhookDelivery).toHaveBeenCalledWith(id);

    await deliverWebhook(id, { fetcher, cipher: CHIFFREUR, finalAttempt: false });
    expect(await livraison()).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      last_status_code: 200,
    });

    const recue = sites.requests.find((r) => r.method === 'POST');
    expect(recue?.headers['mailfind-event']).toBe('import.completed');
    const signature = String(recue?.headers['mailfind-signature'] ?? '');
    expect(verifyWebhookSignature(abonnement.secret, recue?.body ?? '', signature)).toBe(true);
    expect(JSON.parse(recue?.body ?? '{}')).toMatchObject({
      type: 'import.completed',
      data: { import_id: 'x', status: 'completed' },
    });

    const journal = await api.get(`/webhooks/${abonnement.id}/deliveries`);
    expect(journal.body.data).toEqual([
      expect.objectContaining({ status: 'succeeded', attempts: 1 }),
    ]);
  });

  it('retente un echec, et le laisse en echec apres la derniere tentative', async () => {
    await abonner('/__erreur?code=500');
    await emitWebhookEvent(userId, 'import.completed', {});
    const { id } = await livraison();
    await expect(
      deliverWebhook(id, { fetcher, cipher: CHIFFREUR, finalAttempt: false }),
    ).rejects.toThrow(/500/);
    expect(await livraison()).toMatchObject({ status: 'pending', attempts: 1 });
    await deliverWebhook(id, { fetcher, cipher: CHIFFREUR, finalAttempt: true });
    expect(await livraison()).toMatchObject({
      status: 'failed',
      attempts: 2,
      last_status_code: 500,
    });
  });

  it('ne suit pas une redirection, meme vers une adresse publique', async () => {
    await abonner('/__redirection?vers=https://hooks.test/__erreur?code=200');
    await emitWebhookEvent(userId, 'import.completed', {});
    const { id } = await livraison();
    await deliverWebhook(id, { fetcher, cipher: CHIFFREUR, finalAttempt: true });
    expect(await livraison()).toMatchObject({ status: 'failed', last_status_code: 302 });
    expect(sites.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  });

  it('n envoie rien pour un abonnement supprime, ni pour un evenement non choisi', async () => {
    const { id: abonnement } = await abonner('/__erreur?code=200');
    await emitWebhookEvent(userId, 'export.ready', {});
    expect(enqueueWebhookDelivery).not.toHaveBeenCalled();

    await emitWebhookEvent(userId, 'import.completed', {});
    await api.delete(`/webhooks/${abonnement}`);
    const { id } = await livraison();
    await deliverWebhook(id, { fetcher, cipher: CHIFFREUR, finalAttempt: false });
    expect(await livraison()).toMatchObject({ status: 'failed' });
    expect(sites.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('part a la fin d un import, une seule fois', async () => {
    await abonner('/__erreur?code=200');
    const importe = await query<{ id: string }>(
      `insert into imports (user_id, filename, settings, status) values ($1, 'salon.csv', '{}', 'running')
       returning id`,
      [userId],
    );
    const importId = importe.rows[0]?.id ?? '';
    expect(await completeImportIfDone(importId)).toBe(true);
    expect(await completeImportIfDone(importId)).toBe(false);
    const lignes = await query<{ payload: string }>('select payload from webhook_deliveries');
    expect(lignes.rows).toHaveLength(1);
    expect(JSON.parse(lignes.rows[0]?.payload ?? '{}')).toMatchObject({
      type: 'import.completed',
      data: { import_id: importId, name: 'salon.csv', status: 'completed' },
    });
  });
});
