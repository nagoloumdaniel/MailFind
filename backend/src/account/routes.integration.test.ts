import type { Express, RequestHandler } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import { planImport } from '../imports/plan.js';
import { createImport } from '../imports/repository.js';
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

async function importerAlan(proprietaire: string): Promise<string> {
  const cree = await createImport({
    userId: proprietaire,
    filename: 'salon.csv',
    settings: {
      depth: 'quick',
      tags: ['salon'],
      columns: {
        headers: ['Entreprise', 'Domaine', 'CA'],
        mapping: ['company_name', 'domain', null],
      },
    },
    rows: [
      {
        line: 2,
        raw: { Entreprise: 'Alan', Domaine: 'alan.com', CA: '10M' },
        status: 'accepted',
        error: undefined,
      },
      { line: 3, raw: { CA: '1M' }, status: 'rejected', error: 'rien a chercher' },
    ],
  });
  await planImport(cree.id, proprietaire);
  return cree.id;
}

describe('GET /api/account/export (F-104)', () => {
  it('rend les imports, leurs lignes et les entreprises du compte', async () => {
    const importId = await importerAlan(userId);

    const reponse = await request(app).get('/api/account/export');

    expect(reponse.status).toBe(200);
    expect(reponse.body.imports).toHaveLength(1);
    expect(reponse.body.imports[0]).toMatchObject({
      id: importId,
      filename: 'salon.csv',
      status: 'completed',
      settings: { depth: 'quick', tags: ['salon'] },
    });
    expect(reponse.body.imports[0].rows).toEqual([
      expect.objectContaining({
        line: 2,
        status: 'accepted',
        raw: { Entreprise: 'Alan', Domaine: 'alan.com', CA: '10M' },
      }),
      expect.objectContaining({ line: 3, status: 'rejected', error: 'rien a chercher' }),
    ]);
    expect(reponse.body.companies).toEqual([
      expect.objectContaining({
        name: 'Alan',
        domain: 'alan.com',
        tags: ['salon'],
        attributes: { CA: '10M' },
      }),
    ]);
  });

  it('ne rend rien des autres comptes', async () => {
    const autre = await createUser();
    await importerAlan(autre);

    const reponse = await request(app).get('/api/account/export');

    expect(reponse.body.imports).toEqual([]);
    expect(reponse.body.companies).toEqual([]);
  });
});

describe('DELETE /api/account', () => {
  it('efface les imports, leurs lignes et les entreprises avec le compte', async () => {
    await importerAlan(userId);
    const agent = request.agent(app);
    const premiere = await agent.get('/api/auth/me');
    const jeton = (premiere.headers['set-cookie'] as unknown as string[])
      .find((cookie) => cookie.startsWith('mailfind.csrf='))
      ?.split(';')[0]
      ?.slice('mailfind.csrf='.length);

    const reponse = await agent.delete('/api/account').set('x-csrf-token', jeton ?? '');

    expect(reponse.status).toBe(204);
    for (const table of ['imports', 'import_rows', 'companies']) {
      const result = await query<{ n: number }>(`select count(*)::int as n from ${table}`);
      expect(result.rows[0]?.n, table).toBe(0);
    }
  });
});
