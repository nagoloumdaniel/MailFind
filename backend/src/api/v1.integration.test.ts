import type { Express } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiKey } from '../api-keys/repository.js';
import { requireScope } from '../api-keys/authenticate.js';
import { closePool, query } from '../db/pool.js';
import { createUser, resetData } from '../test/integration/db.js';
import { createTestSession } from '../test/session.js';
import { purgeExpiredIdempotencyKeys } from './idempotency.js';
import { createMemoryRateLimitStore, type RateLimitStore } from './rate-limit.js';

let app: Express;
let userId: string;
let secret: string;
let store: RateLimitStore;
let creations = 0;

beforeAll(async () => {
  const { createApp } = await import('../app.js');
  app = createApp({
    logger: pino({ level: 'silent' }),
    session: createTestSession(),
    v1: {
      rateLimitStore: { hit: (cle, fenetre) => store.hit(cle, fenetre) },
      register: (router) => {
        router.get('/essai', (_req, res) => {
          res.json({ ok: true });
        });
        router.post('/essai', requireScope('imports:write'), (req, res) => {
          creations += 1;
          if ((req.body as { panne?: boolean }).panne === true) {
            res.status(500).json({ code: 'panne' });
            return;
          }
          res.status(201).json({ numero: creations, recu: req.body as unknown });
        });
      },
    },
  });
});

beforeEach(async () => {
  await resetData();
  await query('truncate idempotency_keys');
  store = createMemoryRateLimitStore();
  creations = 0;
  userId = await createUser();
  const cle = await createApiKey(userId, 'essai', ['imports:write', 'emails:read']);
  if (cle.kind !== 'created') throw new Error('cle attendue');
  secret = cle.secret;
});

afterAll(async () => {
  await closePool();
});

const bearer = () => `Bearer ${secret}`;

describe('routeur /v1 (F-1301)', () => {
  it('demande une cle avant tout, meme pour une route inconnue', async () => {
    const sans = await request(app).get('/v1/inconnue');
    expect(sans.status).toBe(401);
    const avec = await request(app).get('/v1/inconnue').set('authorization', bearer());
    expect(avec.status).toBe(404);
    expect(avec.headers['content-type']).toMatch(/application\/problem\+json/);
  });

  it('ne pose ni session ni jeton CSRF, et accepte une creation sans jeton', async () => {
    const lecture = await request(app).get('/v1/essai').set('authorization', bearer());
    expect(lecture.status).toBe(200);
    expect(lecture.headers['set-cookie']).toBeUndefined();
    const creation = await request(app)
      .post('/v1/essai')
      .set('authorization', bearer())
      .send({ nom: 'Acme' });
    expect(creation.status).toBe(201);
  });

  it('verifie la portee de la route (F-1303)', async () => {
    const lecture = await createApiKey(userId, 'lecture', ['emails:read']);
    if (lecture.kind !== 'created') throw new Error('cle attendue');
    const reponse = await request(app)
      .post('/v1/essai')
      .set('authorization', `Bearer ${lecture.secret}`)
      .send({});
    expect(reponse.status).toBe(403);
    expect(reponse.body.code).toBe('insufficient_scope');
  });

  it('refuse un compte qui n a pas accepte les conditions en vigueur', async () => {
    await query('update users set terms_version = null where id = $1', [userId]);
    const reponse = await request(app).get('/v1/essai').set('authorization', bearer());
    expect(reponse.status).toBe(403);
    expect(reponse.body.code).toBe('terms_not_accepted');
  });
});

describe('limitation de debit (F-1304)', () => {
  it('s arrete a 60 requetes par minute et par cle, avec Retry-After', async () => {
    let derniere: request.Response | undefined;
    for (let i = 0; i < 60; i += 1) {
      derniere = await request(app).get('/v1/essai').set('authorization', bearer());
    }
    expect(derniere?.status).toBe(200);
    expect(derniere?.headers['ratelimit-remaining']).toBe('0');
    const refus = await request(app).get('/v1/essai').set('authorization', bearer());
    expect(refus.status).toBe(429);
    expect(refus.body.code).toBe('rate_limited');
    expect(Number(refus.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('Idempotency-Key (F-1305)', () => {
  const creer = (corps: object, cle?: string) => {
    const envoi = request(app).post('/v1/essai').set('authorization', bearer());
    return (cle === undefined ? envoi : envoi.set('idempotency-key', cle)).send(corps);
  };

  it('rejoue la reponse de la premiere requete sans rien refaire', async () => {
    const premiere = await creer({ nom: 'Acme' }, 'cle-1');
    const seconde = await creer({ nom: 'Acme' }, 'cle-1');
    expect(premiere.status).toBe(201);
    expect(seconde.status).toBe(201);
    expect(seconde.body).toEqual(premiere.body);
    expect(seconde.headers['idempotent-replayed']).toBe('true');
    expect(creations).toBe(1);
  });

  it('refuse la meme cle pour une autre requete', async () => {
    await creer({ nom: 'Acme' }, 'cle-1');
    const autre = await creer({ nom: 'Globex' }, 'cle-1');
    expect(autre.status).toBe(422);
    expect(autre.body.code).toBe('idempotency_key_reused');
    expect(creations).toBe(1);
  });

  it('cree a chaque fois sans cle, et sous deux cles differentes', async () => {
    await creer({ nom: 'Acme' });
    await creer({ nom: 'Acme' });
    await creer({ nom: 'Acme' }, 'cle-1');
    await creer({ nom: 'Acme' }, 'cle-2');
    expect(creations).toBe(4);
  });

  it('ne garde pas une erreur interne : la requete se retente pour de bon', async () => {
    expect((await creer({ panne: true }, 'cle-1')).status).toBe(500);
    expect((await creer({ panne: true }, 'cle-1')).status).toBe(500);
    expect(creations).toBe(2);
  });

  it('dit qu une requete sous la meme cle est encore en cours', async () => {
    await query(
      `insert into idempotency_keys (user_id, key, request_hash) values ($1, 'cle-1', $2)`,
      [userId, 'a'.repeat(64)],
    );
    // Meme empreinte que la requete : sinon ce serait une cle reutilisee.
    await query(
      `update idempotency_keys set request_hash = encode(sha256(convert_to($1, 'utf8')), 'hex')`,
      [`POST /v1/essai\n${JSON.stringify({ nom: 'Acme' })}`],
    );
    const reponse = await creer({ nom: 'Acme' }, 'cle-1');
    expect(reponse.status).toBe(409);
    expect(reponse.body.code).toBe('idempotency_key_in_progress');
    expect(reponse.headers['retry-after']).toBe('1');
    expect(creations).toBe(0);
  });

  it('oublie une cle au bout de 24 heures', async () => {
    await creer({ nom: 'Acme' }, 'cle-1');
    await query(`update idempotency_keys set created_at = now() - interval '25 hours'`);
    const apres = await creer({ nom: 'Globex' }, 'cle-1');
    expect(apres.status).toBe(201);
    expect(creations).toBe(2);

    await query(`update idempotency_keys set created_at = now() - interval '25 hours'`);
    expect(await purgeExpiredIdempotencyKeys()).toBe(1);
  });

  it('garde les cles de chaque compte a part', async () => {
    await creer({ nom: 'Acme' }, 'cle-1');
    const autre = await createUser();
    const sienne = await createApiKey(autre, 'autre', ['imports:write']);
    if (sienne.kind !== 'created') throw new Error('cle attendue');
    const reponse = await request(app)
      .post('/v1/essai')
      .set('authorization', `Bearer ${sienne.secret}`)
      .set('idempotency-key', 'cle-1')
      .send({ nom: 'Globex' });
    expect(reponse.status).toBe(201);
    expect(creations).toBe(2);
  });

  it('refuse une cle vide ou trop longue', async () => {
    const reponse = await creer({ nom: 'Acme' }, 'x'.repeat(256));
    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('invalid_idempotency_key');
  });
});
