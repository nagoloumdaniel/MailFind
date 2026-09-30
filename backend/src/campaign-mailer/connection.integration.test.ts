import { randomBytes } from 'node:crypto';
import type { Express, RequestHandler } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import { createCipher } from '../security/crypto.js';
import { createUser, resetData } from '../test/integration/db.js';
import { createTestSession } from '../test/session.js';
import { readToken } from './connection.js';

const CHIFFREUR = createCipher(randomBytes(32).toString('hex'));
const JETON = `cm_${'A'.repeat(20)}${'b'.repeat(23)}`;

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
  app = createApp({ logger: pino({ level: 'silent' }), session: connecte, cipher: CHIFFREUR });
});

beforeEach(async () => {
  await resetData();
  userId = await createUser();
});

afterAll(async () => {
  await closePool();
});

async function agentConnecte() {
  const agent = request.agent(app);
  const premiere = await agent.get('/api/campaign-mailer/connection');
  const cookies = ([] as string[]).concat(premiere.headers['set-cookie'] ?? []);
  const jeton = /mailfind\.csrf=([^;]+)/.exec(cookies.join(';'))?.[1] ?? '';
  return { agent, jeton };
}

describe('connexion a Campaign Mailer (F-1201)', () => {
  it('garde le jeton chiffre, ne le rend jamais, et le relit pour appeler', async () => {
    const { agent, jeton } = await agentConnecte();
    const reponse = await agent
      .put('/api/campaign-mailer/connection')
      .set('x-csrf-token', jeton)
      .send({ token: `  ${JETON} ` });

    expect(reponse.status).toBe(200);
    expect(reponse.body).toMatchObject({ connected: true, tokenPrefix: JETON.slice(0, 11) });
    expect(JSON.stringify(reponse.body)).not.toContain(JETON.slice(11));

    const enBase = await query<{ ligne: string }>(
      'select row_to_json(c)::text as ligne from campaign_mailer_connections c',
    );
    expect(enBase.rows[0]?.ligne).not.toContain(JETON.slice(11));
    expect(await readToken(userId, CHIFFREUR)).toBe(JETON);

    const journal = await query<{ metadata: string }>(
      `select metadata::text from audit_events where action = 'campaign_mailer.connected'`,
    );
    expect(journal.rows[0]?.metadata).not.toContain(JETON.slice(11));
  });

  it('refuse un jeton qui n a pas la forme d un jeton de Campaign Mailer', async () => {
    const { agent, jeton } = await agentConnecte();
    for (const token of ['mf_abc', `cm_${'a'.repeat(10)}`, 'Bearer cm_x']) {
      const reponse = await agent
        .put('/api/campaign-mailer/connection')
        .set('x-csrf-token', jeton)
        .send({ token });
      expect(reponse.status, token).toBe(400);
      expect(reponse.body.code).toBe('invalid_campaign_mailer_token');
    }
  });

  it('refuse un changement sans jeton CSRF', async () => {
    const reponse = await request(app)
      .put('/api/campaign-mailer/connection')
      .send({ token: JETON });
    expect(reponse.status).toBe(403);
  });

  it('remplace le jeton, puis deconnecte', async () => {
    const { agent, jeton } = await agentConnecte();
    await agent
      .put('/api/campaign-mailer/connection')
      .set('x-csrf-token', jeton)
      .send({ token: JETON });
    const autre = `cm_${'Z'.repeat(43)}`;
    await agent
      .put('/api/campaign-mailer/connection')
      .set('x-csrf-token', jeton)
      .send({ token: autre });
    expect(await readToken(userId, CHIFFREUR)).toBe(autre);

    const coupe = await agent.delete('/api/campaign-mailer/connection').set('x-csrf-token', jeton);
    expect(coupe.body).toMatchObject({ connected: false, tokenPrefix: null });
    expect(await readToken(userId, CHIFFREUR)).toBeUndefined();
  });

  it('apparait dans l export du compte, sans le jeton (F-104)', async () => {
    const { agent, jeton } = await agentConnecte();
    await agent
      .put('/api/campaign-mailer/connection')
      .set('x-csrf-token', jeton)
      .send({ token: JETON });
    const reponse = await request(app).get('/api/account/export');
    expect(reponse.body.campaignMailer).toMatchObject({
      connected: true,
      tokenPrefix: JETON.slice(0, 11),
    });
    expect(JSON.stringify(reponse.body)).not.toContain(JETON.slice(11));
  });
});
