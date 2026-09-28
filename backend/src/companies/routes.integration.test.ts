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
  userId = await createUser();
});

afterAll(async () => {
  await closePool();
});

async function entreprise(
  nom: string,
  champs: { domain?: string; city?: string; industry?: string; tags?: string[]; crawl?: string },
  adresses: [string, string, string][] = [],
  proprietaire = userId,
): Promise<string> {
  const cree = await query<{ id: string }>(
    `insert into companies (user_id, name, normalized_name, domain, city, industry, tags, crawl_status)
     values ($1, $2, lower($2), $3, $4, $5, $6, $7::crawl_status) returning id`,
    [
      proprietaire,
      nom,
      champs.domain ?? null,
      champs.city ?? null,
      champs.industry ?? null,
      champs.tags ?? [],
      champs.crawl ?? 'done',
    ],
  );
  const id = cree.rows[0]?.id ?? '';
  for (const [adresse, type, statut] of adresses) {
    await query(
      `with e as (
         insert into emails (company_id, user_id, address, normalized_address, local_part, type,
                             origin, status, score)
         values ($1, $2, $3, $3, split_part($3, '@', 1), $4::email_type, 'found',
                 $5::email_status, 50) returning id)
       insert into email_sources (email_id, kind) select id, 'deduction' from e`,
      [id, proprietaire, adresse, type, statut],
    );
  }
  return id;
}

describe('GET /api/companies (F-1002)', () => {
  beforeEach(async () => {
    await entreprise(
      'Acme',
      { domain: 'acme.fr', city: 'Lyon', industry: 'Industrie', tags: ['salon'] },
      [
        ['rh@acme.fr', 'hr', 'valid'],
        ['jobs@acme.fr', 'recruitment', 'unverified'],
      ],
    );
    await entreprise('Boulangerie Martin', { city: 'Paris', industry: 'Commerce' }, [
      ['contact@boulangerie.fr', 'generic', 'valid'],
    ]);
    await entreprise('Cafe Zen', { city: 'lyon', crawl: 'failed' });
  });

  it('liste avec le resume des adresses, et trie par nombre d adresses', async () => {
    const reponse = await request(app).get('/api/companies?sort=emails&dir=desc');
    expect(reponse.body.total).toBe(3);
    expect(reponse.body.companies[0]).toMatchObject({
      name: 'Acme',
      emailCount: 2,
      validCount: 1,
      bestScore: 50,
      tags: ['salon'],
    });
    expect([...(reponse.body.companies[0].types as string[])].sort()).toEqual([
      'hr',
      'recruitment',
    ]);
    expect((reponse.body.companies as unknown[]).at(-1)).toMatchObject({
      name: 'Cafe Zen',
      emailCount: 0,
      types: [],
    });
  });

  it('cherche et combine ville, etiquette, statut de collecte et type present', async () => {
    const noms = async (url: string) =>
      ((await request(app).get(url)).body.companies as { name: string }[]).map((c) => c.name);
    expect(await noms('/api/companies?q=acme.fr')).toEqual(['Acme']);
    expect(await noms('/api/companies?city=LYON')).toEqual(['Acme', 'Cafe Zen']);
    expect(await noms('/api/companies?city=lyon&tag=salon')).toEqual(['Acme']);
    expect(await noms('/api/companies?crawlStatus=failed')).toEqual(['Cafe Zen']);
    expect(await noms('/api/companies?hasType=hr,recruitment')).toEqual(['Acme']);
    expect(await noms('/api/companies?hasType=generic')).toEqual(['Boulangerie Martin']);
  });

  it('propose les valeurs connues des filtres', async () => {
    const reponse = await request(app).get('/api/companies/facets');
    // Une ville par orthographe, quelle que soit la casse.
    expect((reponse.body.cities as string[]).map((v) => v.toLowerCase())).toEqual([
      'lyon',
      'paris',
    ]);
    expect(reponse.body).toMatchObject({
      countries: [],
      industries: ['Commerce', 'Industrie'],
      tags: ['salon'],
    });
  });

  it('ne montre pas les entreprises d un autre compte', async () => {
    const autre = await createUser();
    await entreprise('Secrete', {}, [], autre);
    const reponse = await request(app).get('/api/companies?q=secrete');
    expect(reponse.body.total).toBe(0);
  });
});
