import type { Express, RequestHandler } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import { createUser, resetData } from '../test/integration/db.js';
import { createTestSession } from '../test/session.js';

let app: Express;
let userId: string;

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
  app = createApp({ logger: pino({ level: 'silent' }), session: connecte });
});

beforeEach(async () => {
  await resetData();
  await query('truncate provider_calls');
  userId = await createUser();
});

afterAll(async () => {
  await closePool();
});

describe('GET /api/dashboard (F-1001)', () => {
  it('rend les chiffres reels du compte, et de lui seul', async () => {
    const entreprise = await query<{ id: string }>(
      `insert into companies (user_id, name, normalized_name) values ($1, 'Acme', 'acme') returning id`,
      [userId],
    );
    await query(
      `with e as (
         insert into emails (company_id, user_id, address, normalized_address, local_part, type, origin, status)
         select $1, $2, a, a, split_part(a, '@', 1), 'generic', o::email_origin, s::email_status
           from (values ('a@acme.fr', 'found', 'valid'), ('b@acme.fr', 'found', 'valid'),
                        ('c@acme.fr', 'found', 'unverified'), ('d@acme.fr', 'deduced', 'invalid')) v(a, o, s)
         returning id)
       insert into email_sources (email_id, kind) select id, 'deduction' from e`,
      [entreprise.rows[0]?.id, userId],
    );
    const importe = await query<{ id: string }>(
      `insert into imports (user_id, filename, status) values ($1, 'salon.csv', 'running') returning id`,
      [userId],
    );
    await query(
      `insert into pipeline_jobs (import_id, company_id, step, status)
       values ($1, $2, 'identify', 'done'), ($1, $2, 'crawl', 'running')`,
      [importe.rows[0]?.id, entreprise.rows[0]?.id],
    );
    await query(
      `insert into provider_calls (user_id, provider, operation, idempotency_key, status, credits)
       values ($1, 'hunter', 'verification', 'k1', 'confirmed', 0.5),
              ($1, 'hunter', 'verification', 'k2', 'failed', 0),
              ($1, 'brave', 'web_search', 'k3', 'confirmed', 1)`,
      [userId],
    );
    const autre = await createUser();
    await query(
      `insert into companies (user_id, name, normalized_name) values ($1, 'Autre', 'autre')`,
      [autre],
    );

    const reponse = await request(app).get('/api/dashboard');
    expect(reponse.status).toBe(200);
    expect(reponse.body).toMatchObject({
      companies: 1,
      // La candidate refusee n'est ni comptee ni montree (F-503).
      emailsByStatus: { valid: 2, unverified: 1 },
      importsInProgress: [{ filename: 'salon.csv', finishedSteps: 1, totalSteps: 2 }],
      recentExports: [],
    });
    expect(reponse.body.credits).toEqual([
      { provider: 'brave', operation: 'web_search', used: 1, limit: 80 },
      { provider: 'hunter', operation: 'domain_search', used: 0, limit: 3 },
      // L'appel en echec n'a rien coute et ne compte pas.
      { provider: 'hunter', operation: 'verification', used: 1, limit: 4 },
    ]);
  });
});
