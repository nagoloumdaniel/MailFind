import type { Express } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiKey } from '../../api-keys/repository.js';
import { closePool, query } from '../../db/pool.js';
import type { VerifyDeps } from '../../pipeline/verify.js';
import { createUser, resetData } from '../../test/integration/db.js';
import { createTestSession } from '../../test/session.js';
import { createMemoryRateLimitStore } from '../rate-limit.js';

/** Un DNS simule : acme.fr recoit du courrier, rien d'autre. */
const VERIFICATION: VerifyDeps = {
  mailDns: {
    mx: (domaine) =>
      domaine === 'acme.fr'
        ? Promise.resolve([{ exchange: 'mx.acme.fr', priority: 10 }])
        : Promise.reject(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })),
    hasAddress: () => Promise.resolve(false),
  },
  disposableDomains: () => Promise.resolve(new Set<string>()),
  verificationLimits: { perUserMonthly: 0, globalMonthly: 0 },
};

let app: Express;
let userId: string;
let secret: string;
let acme: string;

beforeAll(async () => {
  const { createApp } = await import('../../app.js');
  app = createApp({
    logger: pino({ level: 'silent' }),
    session: createTestSession(),
    verify: VERIFICATION,
    v1: { rateLimitStore: createMemoryRateLimitStore() },
  });
});

async function entreprise(proprietaire: string, domaine: string): Promise<string> {
  const lignes = await query<{ id: string }>(
    `insert into companies (user_id, name, normalized_name, domain, domain_status)
     values ($1, $2, $2, $2, 'provided') returning id`,
    [proprietaire, domaine],
  );
  return lignes.rows[0]?.id ?? '';
}

async function adresse(
  companyId: string,
  proprietaire: string,
  locale: string,
  champs: { status?: string; origin?: string; tags?: string[] } = {},
): Promise<string> {
  const lignes = await query<{ id: string }>(
    `with e as (
       insert into emails (company_id, user_id, address, normalized_address, local_part, type,
                           origin, status, tags)
       select $1, $2, $3 || '@' || domain, $3 || '@' || domain, $3, 'generic',
              $4::email_origin, $5::email_status, $6::text[]
         from companies where id = $1
       returning id
     ), s as (
       insert into email_sources (email_id, kind, url, extraction_method)
       select id, 'website', 'https://acme.fr/contact', 'mailto' from e
     )
     select id from e`,
    [
      companyId,
      proprietaire,
      locale,
      champs.origin ?? 'found',
      champs.status ?? 'unverified',
      champs.tags ?? [],
    ],
  );
  return lignes.rows[0]?.id ?? '';
}

beforeEach(async () => {
  await resetData();
  await query('truncate idempotency_keys');
  userId = await createUser();
  const cle = await createApiKey(userId, 'essai', ['emails:read', 'companies:write']);
  if (cle.kind !== 'created') throw new Error('cle attendue');
  secret = cle.secret;
  acme = await entreprise(userId, 'acme.fr');
});

afterAll(async () => {
  await closePool();
});

const avecCle = (r: request.Test) => r.set('authorization', `Bearer ${secret}`);
const api = {
  get: (c: string) => avecCle(request(app).get(`/v1${c}`)),
  patch: (c: string) => avecCle(request(app).patch(`/v1${c}`)),
  delete: (c: string) => avecCle(request(app).delete(`/v1${c}`)),
};

describe('GET /v1/emails', () => {
  it('liste les adresses avec leur entreprise et leurs sources, filtrees et paginees', async () => {
    await adresse(acme, userId, 'contact', { status: 'valid', tags: ['salon'] });
    await adresse(acme, userId, 'rh', { status: 'accept_all' });
    await adresse(acme, userId, 'jobs', { status: 'unverified', origin: 'deduced' });
    // F-503 : une candidate refusee n'est jamais montree.
    await adresse(acme, userId, 'drh', { status: 'invalid', origin: 'deduced' });
    const autre = await createUser();
    await adresse(await entreprise(autre, 'globex.fr'), autre, 'contact');

    const tout = await api.get('/emails');
    expect(tout.status).toBe(200);
    expect((tout.body.data as { address: string }[]).map((e) => e.address).sort()).toEqual([
      'contact@acme.fr',
      'jobs@acme.fr',
      'rh@acme.fr',
    ]);
    expect(tout.body.data[0]).toMatchObject({
      company_id: acme,
      company_name: 'acme.fr',
      sources: [expect.objectContaining({ kind: 'website' })],
    });

    const adresses = async (filtre: string) =>
      ((await api.get(`/emails?${filtre}`)).body.data as { address: string }[])
        .map((e) => e.address)
        .sort();
    expect(await adresses('status=valid,accept_all')).toEqual(['contact@acme.fr', 'rh@acme.fr']);
    expect(await adresses('origin=deduced')).toEqual(['jobs@acme.fr']);
    expect(await adresses('tag=salon')).toEqual(['contact@acme.fr']);
    expect(await adresses('q=RH@')).toEqual(['rh@acme.fr']);
    expect(await adresses(`company_id=${acme}`)).toHaveLength(3);

    const page1 = await api.get('/emails?limit=2');
    const page2 = await api.get(`/emails?limit=2&cursor=${page1.body.next_cursor as string}`);
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.next_cursor).toBeNull();
  });

  it('refuse un statut inconnu', async () => {
    const reponse = await api.get('/emails?status=valid,excellent');
    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('invalid_filter');
  });
});

describe('PATCH /v1/emails/{id}', () => {
  it('change le type, remplace les etiquettes et exclut, puis leve sa propre exclusion', async () => {
    const id = await adresse(acme, userId, 'contact', { tags: ['ancienne'] });
    const reponse = await api
      .patch(`/emails/${id}`)
      .send({ type: 'recruitment', tags: ['Salon', 'lyon'], excluded: true });
    expect(reponse.status).toBe(200);
    expect(reponse.body.email).toMatchObject({
      type: 'recruitment',
      tags: ['salon', 'lyon'],
      excluded: true,
    });
    const levee = await api.patch(`/emails/${id}`).send({ excluded: false });
    expect(levee.body.email.excluded).toBe(false);
  });

  it('ne leve pas une exclusion due au statut (D-20)', async () => {
    const id = await adresse(acme, userId, 'contact', { status: 'invalid' });
    await query(
      `update emails set excluded = true, excluded_reason = 'Adresse invalide.' where id = $1`,
      [id],
    );
    const reponse = await api.patch(`/emails/${id}`).send({ excluded: false });
    expect(reponse.body.email.excluded).toBe(true);
  });

  it('refuse une modification vide ou d un champ non modifiable', async () => {
    const id = await adresse(acme, userId, 'contact');
    expect((await api.patch(`/emails/${id}`).send({})).status).toBe(400);
    expect((await api.patch(`/emails/${id}`).send({ address: 'x@acme.fr' })).status).toBe(400);
  });

  it('demande la portee companies:write', async () => {
    const id = await adresse(acme, userId, 'contact');
    const lecture = await createApiKey(userId, 'lecture', ['emails:read']);
    if (lecture.kind !== 'created') throw new Error('cle attendue');
    const reponse = await request(app)
      .patch(`/v1/emails/${id}`)
      .set('authorization', `Bearer ${lecture.secret}`)
      .send({ type: 'hr' });
    expect(reponse.status).toBe(403);
  });
});

describe('DELETE /v1/emails/{id}', () => {
  it('supprime l adresse, et l ajoute a la liste de suppression si demande (R-05)', async () => {
    const id = await adresse(acme, userId, 'contact');
    const reponse = await api.delete(`/emails/${id}?suppress=true`);
    expect(reponse.body).toEqual({ deleted: true, suppressed: 1 });
    expect((await api.delete(`/emails/${id}`)).status).toBe(404);
  });

  it('ne touche pas a l adresse d un autre compte', async () => {
    const autre = await createUser();
    const sienne = await adresse(await entreprise(autre, 'globex.fr'), autre, 'contact');
    expect((await api.delete(`/emails/${sienne}`)).status).toBe(404);
    const reste = await query<{ n: number }>(
      'select count(*)::int as n from emails where id = $1',
      [sienne],
    );
    expect(reste.rows[0]?.n).toBe(1);
  });
});
