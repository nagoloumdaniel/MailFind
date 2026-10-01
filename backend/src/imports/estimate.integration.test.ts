import type { Express, RequestHandler } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Les files ne tournent pas ici : ce lot porte sur ce qui est annonce avant
// qu'un import parte, pas sur son traitement.
vi.mock('../queue/queues.js', () => ({
  enqueueImportPlan: vi.fn(() => Promise.resolve()),
  enqueueCompanyStep: vi.fn(() => Promise.resolve()),
  enqueueExportBuild: vi.fn(() => Promise.resolve()),
  enqueueCampaignMailerPush: vi.fn(() => Promise.resolve()),
}));

import { closePool, query } from '../db/pool.js';
import { claimQuota, quotaLimits } from '../quotas/usage.js';
import { createUser, resetData } from '../test/integration/db.js';
import { createTestSession } from '../test/session.js';
import { CONFIRMATION_THRESHOLD, estimateImport, type ImportEstimate } from './estimate.js';
import { importSettingsSchema } from './settings.js';

const REGLAGES = importSettingsSchema.parse({});
let app: Express;
let userId: string;

beforeAll(async () => {
  const { createApp } = await import('../app.js');
  const base = createTestSession();
  const session: RequestHandler = (req, res, next) => {
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
    session,
    enqueue: () => Promise.resolve(),
  });
});

beforeEach(async () => {
  await resetData();
  await query('delete from quota_usage');
  userId = await createUser();
});

afterAll(async () => {
  await closePool();
});

/** Un agent connecte, avec son jeton anti-falsification. */
async function agentConnecte() {
  const agent = request.agent(app);
  const premiere = await agent.get('/api/imports');
  const cookies = ([] as string[]).concat(premiere.headers['set-cookie'] ?? []);
  const jeton = /mailfind\.csrf=([^;]+)/.exec(cookies.join(';'))?.[1] ?? '';
  return { agent, jeton };
}

const corpsImport = (lignes: number, confirme: boolean) => ({
  filename: 'liste.csv',
  headers: ['entreprise'],
  mapping: ['company_name'],
  rows: Array.from({ length: lignes }, (_, rang) => [`Acme ${String(rang)}`]),
  ...(confirme ? { confirmedEstimate: true } : {}),
});

describe('estimation avant traitement (F-1402)', () => {
  it('majore ce que l import demandera, profondeur comprise', async () => {
    const estimation = await estimateImport(userId, 10, REGLAGES);

    expect(estimation.companies).toBe(10);
    // Profondeur standard : dix pages par entreprise.
    expect(estimation.quotas.find((l) => l.metric === 'pages')?.needed).toBe(100);
    // Un appel de recherche et un d'enrichissement par entreprise.
    expect(estimation.providerCalls).toBe(20);
    // La verification de boite est « jamais » par defaut.
    expect(estimation.mailboxChecks).toBe(0);
  });

  it('compte les verifications de boite quand l import les demande', async () => {
    const reglages = importSettingsSchema.parse({ mailboxCheck: 'found' });

    const estimation = await estimateImport(userId, 4, reglages);

    expect(estimation.mailboxChecks).toBeGreaterThan(0);
  });

  it('ne compte pas un fournisseur que l utilisateur a refuse', async () => {
    const reglages = importSettingsSchema.parse({ providers: [] });

    const estimation = await estimateImport(userId, 10, reglages);

    expect(estimation.providerCalls).toBe(0);
  });

  it('dit que l import s arretera quand le quota n y suffit pas', async () => {
    await claimQuota(userId, 'companies', quotaLimits().companies - 2);

    const estimation = await estimateImport(userId, 10, REGLAGES);

    expect(estimation.willStopEarly).toBe(true);
    expect(estimation.quotas.find((l) => l.metric === 'companies')).toMatchObject({
      needed: 10,
      remaining: 2,
      exceeds: true,
    });
  });

  it('ne demande pas confirmation en dessous du seuil', async () => {
    const estimation = await estimateImport(userId, CONFIRMATION_THRESHOLD, REGLAGES);

    expect(estimation.needsConfirmation).toBe(false);
  });

  it('laisse passer un petit import sans rien demander', async () => {
    const { agent, jeton } = await agentConnecte();

    const reponse = await agent
      .post('/api/imports')
      .set('x-csrf-token', jeton)
      .send(corpsImport(3, false));

    expect(reponse.status).toBe(201);
  });

  it('refuse un gros import non confirme, et rend l estimation', async () => {
    const { agent, jeton } = await agentConnecte();

    const reponse = await agent
      .post('/api/imports')
      .set('x-csrf-token', jeton)
      .send(corpsImport(CONFIRMATION_THRESHOLD + 1, false));

    expect(reponse.status).toBe(409);
    expect(reponse.body).toMatchObject({ code: 'estimate_not_confirmed' });
    expect(reponse.body.estimate).toMatchObject({
      companies: CONFIRMATION_THRESHOLD + 1,
      needsConfirmation: true,
    });
    const imports = await query<{ n: string }>('select count(*)::text as n from imports');
    expect(imports.rows[0]?.n).toBe('0');
  });

  it('accepte le meme import une fois confirme', async () => {
    const { agent, jeton } = await agentConnecte();

    const reponse = await agent
      .post('/api/imports')
      .set('x-csrf-token', jeton)
      .send(corpsImport(CONFIRMATION_THRESHOLD + 1, true));

    expect(reponse.status).toBe(201);
  });

  it('rend une estimation seule, sans lancer d import', async () => {
    const { agent, jeton } = await agentConnecte();

    const reponse = await agent
      .post('/api/imports/estimation')
      .set('x-csrf-token', jeton)
      .send({ rows: 50, settings: { depth: 'quick' } });

    expect(reponse.status).toBe(200);
    const estimation = (reponse.body as { estimate: ImportEstimate }).estimate;
    expect(estimation).toMatchObject({ companies: 50, needsConfirmation: true });
    // Profondeur rapide : trois pages par entreprise.
    expect(estimation.quotas.find((ligne) => ligne.metric === 'pages')).toMatchObject({
      needed: 150,
    });
    const imports = await query<{ n: string }>('select count(*)::text as n from imports');
    expect(imports.rows[0]?.n).toBe('0');
  });
});
