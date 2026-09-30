import type { Express, RequestHandler } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import { createUser, resetData } from '../test/integration/db.js';
import { createTestSession } from '../test/session.js';
import type { SsoIdentity } from './shared.js';

const SECRET = 'secret-partage-de-test-assez-long-pour-le-schema';
const STATE = 'etat-de-campaign-mailer-0123456789';

let app: Express;
/** Le compte que la session porte, ou personne. */
let connecte: string | undefined;
/** Ce que le faux Campaign Mailer repond a l'echange du code. */
let identite: SsoIdentity;
const codesEchanges: string[] = [];

beforeAll(async () => {
  const { createApp } = await import('../app.js');
  const base = createTestSession();
  const session: RequestHandler = (req, res, next) => {
    base(req, res, (erreur?: unknown) => {
      if (erreur !== undefined) {
        next(erreur);
        return;
      }
      if (connecte !== undefined && req.session.userId === undefined) {
        req.session.userId = connecte;
      }
      next();
    });
  };
  app = createApp({
    logger: pino({ level: 'silent' }),
    session,
    sso: {
      exchange: (code) => {
        codesEchanges.push(code);
        return Promise.resolve(identite);
      },
    },
  });
});

beforeEach(async () => {
  await resetData();
  connecte = undefined;
  codesEchanges.length = 0;
});

afterAll(async () => {
  await closePool();
});

async function googleIdDe(userId: string): Promise<{ google_id: string; email: string }> {
  const ligne = await query<{ google_id: string; email: string }>(
    'select google_id, email from users where id = $1',
    [userId],
  );
  const trouve = ligne.rows[0];
  if (trouve === undefined) throw new Error('compte absent');
  return trouve;
}

async function codePour(userId: string): Promise<string> {
  connecte = userId;
  const reponse = await request(app).get(`/api/sso/authorize?state=${STATE}`);
  expect(reponse.status).toBe(302);
  const retour = new URL(reponse.headers.location ?? '');
  expect(`${retour.origin}${retour.pathname}`).toBe(
    'http://campaign-mailer.test/api/auth/mailfind/callback',
  );
  expect(retour.searchParams.get('state')).toBe(STATE);
  return retour.searchParams.get('code') ?? '';
}

const echanger = (code: string, secret = SECRET) =>
  request(app).post('/api/sso/token').set('authorization', `Bearer ${secret}`).send({ code });

describe('MailFind fournisseur d identite pour Campaign Mailer (D-26)', () => {
  it('emet un code que Campaign Mailer echange une seule fois contre l identite', async () => {
    const userId = await createUser();
    const code = await codePour(userId);

    const premier = await echanger(code);
    expect(premier.status).toBe(200);
    expect(premier.headers['cache-control']).toBe('no-store');
    const { google_id, email } = await googleIdDe(userId);
    expect(premier.body).toEqual({ google_id, email, name: 'Test' });

    const rejoue = await echanger(code);
    expect(rejoue.status).toBe(400);
    expect(rejoue.body).toMatchObject({ code: 'invalid_grant' });

    const enBase = await query<{ code_hash: string }>('select code_hash from sso_codes');
    expect(enBase.rows[0]?.code_hash).not.toBe(code);
  });

  it('refuse un secret faux, un code perime, un code invente', async () => {
    const userId = await createUser();
    const code = await codePour(userId);

    expect((await echanger(code, 'x'.repeat(48))).status).toBe(401);
    expect((await request(app).post('/api/sso/token').send({ code })).status).toBe(401);

    await query(`update sso_codes set expires_at = now() - interval '1 second'`);
    expect((await echanger(code)).status).toBe(400);
    expect((await echanger('A'.repeat(43))).status).toBe(400);
  });

  it('fait passer par Google une personne pas encore connectee, puis revient', async () => {
    const reponse = await request(app).get(`/api/sso/authorize?state=${STATE}`);

    expect(reponse.status).toBe(302);
    expect(reponse.headers.location).toBe('/api/auth/google');
    const cookies = ([] as string[]).concat(reponse.headers['set-cookie'] ?? []);
    const attente = cookies.find((c) => c.startsWith('mailfind.sso='));
    expect(attente).toContain(STATE);
    expect(attente).toContain('HttpOnly');
  });

  it('refuse un jeton d etat mal forme, sans rediriger', async () => {
    connecte = await createUser();
    const reponse = await request(app).get('/api/sso/authorize?state=court');
    expect(reponse.status).toBe(400);
  });
});

describe('Se connecter avec Campaign Mailer (D-26)', () => {
  async function connexion(): Promise<{
    location: string;
    agent: ReturnType<typeof request.agent>;
  }> {
    const agent = request.agent(app);
    const depart = await agent.get('/api/auth/campaign-mailer');
    expect(depart.status).toBe(302);
    const demande = new URL(depart.headers.location ?? '');
    expect(`${demande.origin}${demande.pathname}`).toBe(
      'http://campaign-mailer.test/api/sso/authorize',
    );
    const state = demande.searchParams.get('state') ?? '';
    const retour = await agent.get(
      `/api/auth/campaign-mailer/callback?code=${'c'.repeat(43)}&state=${state}`,
    );
    return { location: retour.headers.location ?? '', agent };
  }

  it('cree le compte quand il n existe pas, et ouvre la session', async () => {
    identite = { google_id: 'google-nouveau', email: 'Nouvelle@Exemple.test', name: null };

    const { location, agent } = await connexion();

    expect(location).toBe('http://localhost:5173');
    expect(codesEchanges).toEqual(['c'.repeat(43)]);
    const moi = await agent.get('/api/auth/me');
    expect(moi.body.user).toMatchObject({ email: 'nouvelle@exemple.test', termsAccepted: false });
    const journal = await query<{ action: string; metadata: { via: string } }>(
      'select action, metadata from audit_events',
    );
    expect(journal.rows).toContainEqual({
      action: 'user.signed_up',
      metadata: { via: 'campaign_mailer' },
    });
  });

  it('retrouve le compte Google existant, sans doublon et sans effacer le nom', async () => {
    const userId = await createUser();
    const { google_id, email } = await googleIdDe(userId);
    identite = { google_id, email, name: null };

    const { agent } = await connexion();

    const moi = await agent.get('/api/auth/me');
    expect(moi.body.user).toMatchObject({ id: userId, name: 'Test' });
    const comptes = await query<{ n: string }>('select count(*)::text as n from users');
    expect(comptes.rows[0]?.n).toBe('1');
  });

  it('refuse une adresse deja prise par un autre compte Google', async () => {
    const userId = await createUser();
    const { email } = await googleIdDe(userId);
    identite = { google_id: 'un-autre-compte-google', email, name: null };

    const { location, agent } = await connexion();

    expect(location).toBe('http://localhost:5173/connexion?erreur=conflit');
    expect((await agent.get('/api/auth/me')).body).toEqual({ user: null });
  });

  it('refuse un retour dont le jeton d etat ne correspond pas', async () => {
    identite = { google_id: 'g', email: 'a@exemple.test', name: null };
    const agent = request.agent(app);
    await agent.get('/api/auth/campaign-mailer');

    const retour = await agent.get(
      `/api/auth/campaign-mailer/callback?code=${'c'.repeat(43)}&state=${STATE}`,
    );

    expect(retour.headers.location).toBe('http://localhost:5173/connexion?erreur=refus');
    expect(codesEchanges).toEqual([]);
  });
});
