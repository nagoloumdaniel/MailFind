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
const enFile: string[] = [];

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
    cipher: CHIFFREUR,
    enqueuePush: (id) => {
      enFile.push(id);
      return Promise.resolve();
    },
  });
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

describe('envois depuis l interface (F-1202)', () => {
  it('lance un envoi, le met en file, et le laisse suivre par son identifiant', async () => {
    const { agent, jeton } = await agentConnecte();
    await agent
      .put('/api/campaign-mailer/connection')
      .set('x-csrf-token', jeton)
      .send({ token: JETON });
    await query(
      `with c as (
         insert into companies (user_id, name, normalized_name, domain, domain_status)
         values ($1, 'Acme', 'acme', 'acme.fr', 'provided') returning id
       ), e as (
         insert into emails (company_id, user_id, address, normalized_address, local_part, type, origin, status)
         select id, $1, 'rh@acme.fr', 'rh@acme.fr', 'rh', 'hr', 'found', 'valid' from c returning id
       )
       insert into email_sources (email_id, kind, url, extraction_method)
       select id, 'website', 'https://acme.fr/contact', 'mailto' from e`,
      [userId],
    );

    const cree = await agent
      .post('/api/campaign-mailer/pushes')
      .set('x-csrf-token', jeton)
      .send({ campaignName: 'Alternance', scope: { kind: 'library' } });
    expect(cree.status).toBe(202);
    const id = cree.body.push.id as string;
    expect(cree.body.push).toMatchObject({ status: 'pending', campaignName: 'Alternance' });
    expect(enFile).toContain(id);

    const suivi = await agent.get(`/api/campaign-mailer/pushes/${id}`);
    expect(suivi.body.push.id).toBe(id);
    expect((await agent.get('/api/campaign-mailer/pushes')).body.pushes).toHaveLength(1);
  });

  it('refuse un envoi sans nom de campagne, et ne montre pas l envoi d un autre compte', async () => {
    const { agent, jeton } = await agentConnecte();
    const refus = await agent
      .post('/api/campaign-mailer/pushes')
      .set('x-csrf-token', jeton)
      .send({ campaignName: ' ', scope: { kind: 'library' } });
    expect(refus.status).toBe(400);
    expect(
      (await agent.get('/api/campaign-mailer/pushes/01a0ede9-57d4-71e3-b0c4-d359a183d46b')).status,
    ).toBe(404);
  });
});
