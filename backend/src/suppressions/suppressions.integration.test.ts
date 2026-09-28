import type { Express, RequestHandler } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, getPool, query } from '../db/pool.js';
import { saveCrawlReport } from '../pipeline/crawl.js';
import { createUser, resetData } from '../test/integration/db.js';
import { createTestSession } from '../test/session.js';
import { addSuppressions, hashAddress } from './repository.js';

let app: Express;
let userId: string;
let companyId: string;

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
  const cree = await query<{ id: string }>(
    `insert into companies (user_id, name, normalized_name, domain) values ($1, 'Acme', 'acme', 'acme.fr') returning id`,
    [userId],
  );
  companyId = cree.rows[0]?.id ?? '';
});

afterAll(async () => {
  await closePool();
});

const rapport = (...adresses: string[]) => ({
  pages: [],
  notes: [],
  addresses: adresses.map((adresse) => ({
    address: adresse,
    normalized: adresse.toLowerCase(),
    method: 'text' as const,
    excerpt: adresse,
    pageUrl: 'https://acme.fr/contact',
  })),
});

async function adresses(): Promise<
  { normalized_address: string; status: string; score: number | null }[]
> {
  const result = await query<{ normalized_address: string; status: string; score: number | null }>(
    'select normalized_address, status::text as status, score from emails order by 1',
  );
  return result.rows;
}

describe('liste de suppression (R-04, niveau 7)', () => {
  it('ne garde que l empreinte de l adresse', async () => {
    await addSuppressions(userId, ['Jean.Dupont@Acme.fr'], 'demande de la personne');
    const brut = await query<{ texte: string }>(
      'select row_to_json(s)::text as texte from suppressions s',
    );
    expect(brut.rows[0]?.texte).not.toContain('dupont');
    expect(brut.rows[0]?.texte).toContain(hashAddress('jean.dupont@acme.fr'));
  });

  it('fait passer supprimee, score a zero, une adresse deja dans la bibliotheque', async () => {
    await saveCrawlReport(companyId, userId, rapport('rh@acme.fr', 'contact@acme.fr'));
    const resultat = await addSuppressions(userId, ['RH@acme.fr', 'pas une adresse'], undefined);

    expect(resultat).toEqual({ added: 1, alreadyListed: 0, invalid: 1, libraryUpdated: 1 });
    expect(await adresses()).toEqual([
      { normalized_address: 'contact@acme.fr', status: 'unverified', score: null },
      { normalized_address: 'rh@acme.fr', status: 'suppressed', score: 0 },
    ]);
  });

  it('ne collecte plus jamais une adresse supprimee', async () => {
    await addSuppressions(userId, ['rh@acme.fr'], undefined);
    await saveCrawlReport(companyId, userId, rapport('rh@acme.fr', 'contact@acme.fr'));
    expect((await adresses()).map((a) => a.normalized_address)).toEqual(['contact@acme.fr']);
  });

  it('ne touche pas la liste ni la bibliotheque d un autre compte', async () => {
    await saveCrawlReport(companyId, userId, rapport('rh@acme.fr'));
    const autre = await createUser();
    await addSuppressions(autre, ['rh@acme.fr'], undefined);
    expect((await adresses())[0]?.status).toBe('unverified');
  });

  it('se gere par l API : compte, verification, ajout, retrait', async () => {
    const agent = request.agent(app);
    const premiere = await agent.get('/api/auth/me');
    const jeton =
      (premiere.headers['set-cookie'] as unknown as string[])
        .find((cookie) => cookie.startsWith('mailfind.csrf='))
        ?.split(';')[0]
        ?.slice('mailfind.csrf='.length) ?? '';

    const ajout = await agent
      .post('/api/suppressions')
      .set('x-csrf-token', jeton)
      .send({ addresses: ['rh@acme.fr', 'contact@acme.fr'] });
    expect(ajout.status).toBe(201);
    expect((await agent.get('/api/suppressions')).body).toEqual({ count: 2 });

    const verification = await agent
      .post('/api/suppressions/check')
      .set('x-csrf-token', jeton)
      .send({ address: 'RH@ACME.FR' });
    expect(verification.body).toEqual({ suppressed: true });

    const retrait = await agent
      .post('/api/suppressions/remove')
      .set('x-csrf-token', jeton)
      .send({ address: 'rh@acme.fr' });
    expect(retrait.body).toEqual({ removed: true });
    expect((await agent.get('/api/suppressions')).body).toEqual({ count: 1 });

    const audit = await getPool().query<{ metadata: unknown }>(
      `select metadata from audit_events where action = 'suppression.added'`,
    );
    expect(JSON.stringify(audit.rows)).not.toContain('acme');
  });
});
