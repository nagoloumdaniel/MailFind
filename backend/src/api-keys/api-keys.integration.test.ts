import express, { type Express, type RequestHandler } from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import { errorHandler } from '../http/middleware/error-handler.js';
import { createUser, resetData } from '../test/integration/db.js';
import { createTestSession } from '../test/session.js';
import { requireApiKey } from './authenticate.js';
import { createApiKey, MAX_ACTIVE_KEYS } from './repository.js';

let app: Express;
let userId: string;

/** Une API minimale derriere la cle, pour tester le middleware seul. */
const api = express();
// Le gestionnaire d'erreurs journalise par req.log, pose par pino-http.
api.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
api.get('/v1/essai', requireApiKey('emails:read'), (req, res) => {
  res.json({ userId: req.currentUser?.id, keyId: req.apiKey?.id });
});
api.use(errorHandler);

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

/** Le jeton CSRF que la page lirait dans son cookie, puis renverrait en en-tete. */
async function agentConnecte() {
  const agent = request.agent(app);
  const premiere = await agent.get('/api/account/api-keys');
  const cookies = ([] as string[]).concat(premiere.headers['set-cookie'] ?? []);
  const jeton = /mailfind\.csrf=([^;]+)/.exec(cookies.join(';'))?.[1] ?? '';
  return { agent, jeton };
}

describe('cles d API depuis la page Compte (F-1302)', () => {
  it('montre le secret une seule fois, et ne garde que son empreinte', async () => {
    const { agent, jeton } = await agentConnecte();
    const cree = await agent
      .post('/api/account/api-keys')
      .set('x-csrf-token', jeton)
      .send({ name: '  CRM maison ', scopes: ['emails:read', 'verify', 'verify'] });

    expect(cree.status).toBe(201);
    expect(cree.headers['cache-control']).toBe('no-store');
    const secret = cree.body.secret as string;
    expect(secret).toMatch(/^mf_/);
    expect(cree.body.key).toMatchObject({
      name: 'CRM maison',
      prefix: secret.slice(0, 11),
      scopes: ['emails:read', 'verify'],
      lastUsedAt: null,
      revokedAt: null,
    });

    const liste = await agent.get('/api/account/api-keys');
    expect(liste.body.keys).toHaveLength(1);
    expect(JSON.stringify(liste.body)).not.toContain(secret);
    expect(liste.body.keys[0]).not.toHaveProperty('keyHash');

    const enBase = await query<{ ligne: string }>(
      'select row_to_json(k)::text as ligne from api_keys k',
    );
    expect(enBase.rows[0]?.ligne).not.toContain(secret.slice(11));

    const journal = await query<{ action: string; metadata: string }>(
      `select action, metadata::text from audit_events where action = 'api_key.created'`,
    );
    expect(journal.rows).toHaveLength(1);
    expect(journal.rows[0]?.metadata).not.toContain(secret.slice(11));
  });

  it('refuse un nom vide ou une portee inconnue (F-1303)', async () => {
    const { agent, jeton } = await agentConnecte();
    for (const corps of [
      { name: ' ', scopes: ['verify'] },
      { name: 'CRM', scopes: [] },
      { name: 'CRM', scopes: ['admin'] },
    ]) {
      const reponse = await agent
        .post('/api/account/api-keys')
        .set('x-csrf-token', jeton)
        .send(corps);
      expect(reponse.status, JSON.stringify(corps)).toBe(400);
      expect(reponse.body.code).toBe('invalid_api_key_request');
    }
  });

  it('refuse une creation sans jeton CSRF', async () => {
    const reponse = await request(app)
      .post('/api/account/api-keys')
      .send({ name: 'CRM', scopes: ['verify'] });
    expect(reponse.status).toBe(403);
  });

  it(`s arrete a ${String(MAX_ACTIVE_KEYS)} cles actives, une revoquee liberant sa place`, async () => {
    for (let i = 0; i < MAX_ACTIVE_KEYS; i += 1)
      await createApiKey(userId, `cle ${String(i)}`, ['verify']);
    const { agent, jeton } = await agentConnecte();
    const refus = await agent
      .post('/api/account/api-keys')
      .set('x-csrf-token', jeton)
      .send({ name: 'une de trop', scopes: ['verify'] });
    expect(refus.status).toBe(409);
    expect(refus.body.code).toBe('api_key_limit_reached');

    const premiere = (await agent.get('/api/account/api-keys')).body.keys[0].id as string;
    await agent.delete(`/api/account/api-keys/${premiere}`).set('x-csrf-token', jeton);
    const apres = await agent
      .post('/api/account/api-keys')
      .set('x-csrf-token', jeton)
      .send({ name: 'remplacante', scopes: ['verify'] });
    expect(apres.status).toBe(201);
  });

  it('ne depasse pas le plafond sous des creations simultanees', async () => {
    const issues = await Promise.all(
      Array.from({ length: MAX_ACTIVE_KEYS + 5 }, (_, i) =>
        createApiKey(userId, `cle ${String(i)}`, ['verify']),
      ),
    );
    expect(issues.filter((issue) => issue.kind === 'created')).toHaveLength(MAX_ACTIVE_KEYS);
  });

  it('revoque une cle du compte, une seule fois, et jamais celle d un autre', async () => {
    const autre = await createUser();
    const sienne = await createApiKey(autre, 'autre', ['verify']);
    const mienne = await createApiKey(userId, 'mienne', ['verify']);
    if (sienne.kind !== 'created' || mienne.kind !== 'created') throw new Error('cles attendues');
    const { agent, jeton } = await agentConnecte();

    const refus = await agent
      .delete(`/api/account/api-keys/${sienne.key.id}`)
      .set('x-csrf-token', jeton);
    expect(refus.status).toBe(404);
    const ok = await agent
      .delete(`/api/account/api-keys/${mienne.key.id}`)
      .set('x-csrf-token', jeton);
    expect(ok.status).toBe(200);
    expect(ok.body.key.revokedAt).not.toBeNull();
    const encore = await agent
      .delete(`/api/account/api-keys/${mienne.key.id}`)
      .set('x-csrf-token', jeton);
    expect(encore.status).toBe(404);
    const illisible = await agent
      .delete('/api/account/api-keys/pas-un-uuid')
      .set('x-csrf-token', jeton);
    expect(illisible.status).toBe(404);
  });

  it('apparait dans l export du compte, sans empreinte (F-104)', async () => {
    await createApiKey(userId, 'CRM', ['emails:read']);
    const reponse = await request(app).get('/api/account/export');
    expect(reponse.body.apiKeys).toHaveLength(1);
    expect(reponse.body.apiKeys[0]).toMatchObject({ name: 'CRM', scopes: ['emails:read'] });
    expect(reponse.body.apiKeys[0]).not.toHaveProperty('keyHash');
  });
});

describe('requireApiKey, authentification de l API publique', () => {
  async function cle(scopes: Parameters<typeof createApiKey>[2] = ['emails:read']) {
    const issue = await createApiKey(userId, 'essai', scopes);
    if (issue.kind !== 'created') throw new Error('cle attendue');
    return issue;
  }

  it('laisse passer une cle active qui a la portee, et note son usage', async () => {
    const { secret, key } = await cle();
    const reponse = await request(api).get('/v1/essai').set('authorization', `Bearer ${secret}`);
    expect(reponse.status).toBe(200);
    expect(reponse.body).toEqual({ userId, keyId: key.id });
    const usage = await query<{ last_used_at: Date | null }>('select last_used_at from api_keys');
    expect(usage.rows[0]?.last_used_at).not.toBeNull();
  });

  it('refuse de la meme facon une cle absente, mal formee, inconnue ou revoquee', async () => {
    const { secret, key } = await cle();
    await query('update api_keys set revoked_at = now() where id = $1', [key.id]);
    const inconnue = `mf_${'a'.repeat(43)}`;
    for (const entete of [
      undefined,
      'Bearer',
      `Basic ${secret}`,
      'Bearer mf_court',
      `Bearer ${inconnue}`,
      `Bearer ${secret}`,
    ]) {
      const essai = request(api).get('/v1/essai');
      const reponse = await (entete === undefined ? essai : essai.set('authorization', entete));
      expect(reponse.status, entete).toBe(401);
      expect(reponse.body.code).toBe('invalid_api_key');
      expect(reponse.headers['www-authenticate']).toBe('Bearer realm="MailFind"');
      expect(reponse.headers['content-type']).toMatch(/application\/problem\+json/);
    }
  });

  it('refuse une cle sans la portee demandee (F-1303)', async () => {
    const { secret } = await cle(['verify']);
    const reponse = await request(api).get('/v1/essai').set('authorization', `Bearer ${secret}`);
    expect(reponse.status).toBe(403);
    expect(reponse.body.code).toBe('insufficient_scope');
  });

  it('refuse la cle d un compte supprime', async () => {
    const { secret } = await cle();
    await query('update users set deleted_at = now() where id = $1', [userId]);
    const reponse = await request(api).get('/v1/essai').set('authorization', `Bearer ${secret}`);
    expect(reponse.status).toBe(401);
  });

  it('n ecrit la date d usage qu une fois par minute', async () => {
    const { secret } = await cle();
    await request(api).get('/v1/essai').set('authorization', `Bearer ${secret}`);
    const avant = await query<{ t: Date }>('select last_used_at as t from api_keys');
    await request(api).get('/v1/essai').set('authorization', `Bearer ${secret}`);
    const apres = await query<{ t: Date }>('select last_used_at as t from api_keys');
    expect(apres.rows[0]?.t).toEqual(avant.rows[0]?.t);
  });
});
