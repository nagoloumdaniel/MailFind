import type { Express, RequestHandler } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool } from '../db/pool.js';
import { addSuppressions } from '../suppressions/repository.js';
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
  return { agent, jeton };
}

describe('POST /api/verifications/one-off (F-705)', () => {
  // Des adresses tranchees avant le DNS : le test ne sort pas sur le reseau.
  it('rend un verdict par adresse, liste de suppression du compte comprise', async () => {
    await addSuppressions(userId, ['ne.plus@acme.fr'], undefined);
    const { agent, jeton } = await agentAvecJeton();
    const reponse = await agent
      .post('/api/verifications/one-off')
      .set('x-csrf-token', jeton)
      .send({ addresses: ['pas une adresse', 'x@yopmail.com', 'Ne.Plus@acme.fr'] });

    expect(reponse.status).toBe(200);
    expect(
      (reponse.body.results as { input: string; status: string }[]).map(
        (r) => `${r.input} ${r.status}`,
      ),
    ).toEqual([
      'pas une adresse invalid',
      'x@yopmail.com disposable',
      'Ne.Plus@acme.fr suppressed',
    ]);
  });

  it('refuse une liste vide ou de plus de 1 000 adresses', async () => {
    const { agent, jeton } = await agentAvecJeton();
    const vide = await agent
      .post('/api/verifications/one-off')
      .set('x-csrf-token', jeton)
      .send({ addresses: [] });
    expect(vide.status).toBe(400);
    const trop = await agent
      .post('/api/verifications/one-off')
      .set('x-csrf-token', jeton)
      .send({ addresses: Array.from({ length: 1001 }, (_, i) => `a${String(i)}@yopmail.com`) });
    expect(trop.status).toBe(400);
    expect(trop.body).toMatchObject({ code: 'invalid_address_list' });
  });

  it('refuse un appel sans jeton CSRF', async () => {
    const { agent } = await agentAvecJeton();
    const reponse = await agent
      .post('/api/verifications/one-off')
      .send({ addresses: ['x@yopmail.com'] });
    expect(reponse.status).toBe(403);
  });
});
