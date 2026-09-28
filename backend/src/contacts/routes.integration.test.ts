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

/**
 * Mille adresses sur cinquante entreprises, avec des statuts, des types, des
 * scores et des noms varies, dont des vides : le jeu de la Definition of Done.
 */
async function semer(proprietaire = userId): Promise<void> {
  await query(
    `insert into companies (user_id, name, normalized_name, domain)
     select $1, 'Entreprise ' || lpad(n::text, 2, '0'), 'entreprise ' || n, 'e' || n || '.fr'
       from generate_series(1, 50) n`,
    [proprietaire],
  );
  await query(
    `with nouvelles as (
       insert into emails (company_id, user_id, address, normalized_address, local_part, type,
                           origin, status, score, contact_name)
       select c.id, $1, 'a' || n || '@' || c.domain, 'a' || n || '@' || c.domain, 'a' || n,
              (array['recruitment','hr','generic','sales','unknown'])[1 + n % 5]::email_type,
              (array['found','provider','deduced'])[1 + n % 3]::email_origin,
              (array['valid','accept_all','unverified','risky'])[1 + n % 4]::email_status,
              case when n % 10 = 0 then null else n % 101 end,
              case when n % 7 = 0 then null else 'Contact ' || lpad(n::text, 4, '0') end
         from generate_series(1, 1000) n
         join companies c on c.user_id = $1 and c.domain = 'e' || (1 + n % 50) || '.fr'
       returning id
     )
     insert into email_sources (email_id, kind) select id, 'deduction' from nouvelles`,
    [proprietaire],
  );
}

describe('GET /api/contacts', () => {
  it('pagine mille adresses, sans doublon ni oubli, avec le total (DoD Phase 6)', async () => {
    await semer();
    const vus = new Set<string>();
    for (let page = 1; page <= 10; page += 1) {
      const reponse = await request(app).get(`/api/contacts?pageSize=100&page=${String(page)}`);
      expect(reponse.status).toBe(200);
      expect(reponse.body.total).toBe(1000);
      for (const contact of reponse.body.contacts as { id: string }[]) vus.add(contact.id);
    }
    expect(vus.size).toBe(1000);
    const apres = await request(app).get('/api/contacts?pageSize=100&page=11');
    expect(apres.body).toMatchObject({ total: 1000, contacts: [] });
  });

  it('trie dans les deux sens, les valeurs vides toujours en fin de liste (F-1011)', async () => {
    await semer();
    for (const dir of ['asc', 'desc']) {
      const tous = await request(app).get(
        `/api/contacts?sort=score&dir=${dir}&pageSize=100&page=10`,
      );
      const derniers = tous.body.contacts as { score: number | null }[];
      expect(derniers.at(-1)?.score, dir).toBeNull();
      const premiers = await request(app).get(`/api/contacts?sort=score&dir=${dir}&pageSize=25`);
      const scores = (premiers.body.contacts as { score: number }[]).map((c) => c.score);
      expect(scores[0], dir).toBe(dir === 'asc' ? 0 : 100);
      expect(scores).toEqual([...scores].sort((a, b) => (dir === 'asc' ? a - b : b - a)));
    }
    const noms = await request(app).get('/api/contacts?sort=name&dir=desc&pageSize=100&page=10');
    expect((noms.body.contacts as { contactName: string | null }[]).at(-1)?.contactName).toBeNull();
    const types = await request(app).get('/api/contacts?sort=type&pageSize=25');
    expect((types.body.contacts as { type: string }[])[0]?.type).toBe('recruitment');
  });

  it('cherche dans l adresse, le nom, l entreprise et le domaine, et combine les filtres (F-1012)', async () => {
    await semer();
    const parEntreprise = await request(app).get('/api/contacts?q=entreprise%2007');
    expect(parEntreprise.body.total).toBe(20);
    const parDomaine = await request(app).get('/api/contacts?q=e7.fr');
    expect(parDomaine.body.total).toBe(20);
    const parNom = await request(app).get('/api/contacts?q=contact%200043');
    expect(parNom.body.total).toBe(1);
    const parAdresse = await request(app).get('/api/contacts?q=A42@');
    expect(parAdresse.body.contacts[0].address).toBe('a42@e43.fr');
    // Un joker tape n'est pas un joker.
    expect((await request(app).get('/api/contacts?q=%25')).body.total).toBe(0);

    const combines = await request(app).get(
      '/api/contacts?status=valid&type=hr,generic&pageSize=100',
    );
    const lignes = combines.body.contacts as { status: string; type: string }[];
    expect(combines.body.total).toBe(lignes.length);
    expect(lignes.length).toBeGreaterThan(0);
    for (const ligne of lignes) {
      expect(ligne.status).toBe('valid');
      expect(['hr', 'generic']).toContain(ligne.type);
    }
  });

  it('ne montre ni les contacts d un autre compte, ni une candidate ecartee (S-04, F-503)', async () => {
    const autre = await createUser();
    await semer(autre);
    expect((await request(app).get('/api/contacts')).body.total).toBe(0);
    const unAutre = await query<{ id: string }>('select id from emails limit 1');
    expect((await request(app).get(`/api/contacts/${unAutre.rows[0]?.id ?? ''}`)).status).toBe(404);

    await semer();
    await query(`update emails set excluded = true where user_id = $1 and origin = 'deduced'`, [
      userId,
    ]);
    const reponse = await request(app).get('/api/contacts?origin=deduced');
    expect(reponse.body.total).toBe(0);
  });

  it('refuse un tri ou un filtre inconnu', async () => {
    const reponse = await request(app).get('/api/contacts?sort=password');
    expect(reponse.status).toBe(400);
    expect(reponse.body).toMatchObject({ code: 'invalid_contact_query' });
  });
});
