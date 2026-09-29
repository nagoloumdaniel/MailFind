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
      status: 'running',
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

  /** Une adresse d'Alan, sa source et une verification, comme les laisse le pipeline. */
  async function adresseAlan(proprietaire: string): Promise<void> {
    const entreprise = await query<{ id: string }>('select id from companies where user_id = $1', [
      proprietaire,
    ]);
    // L'adresse et sa source dans la meme instruction : la base refuse une
    // adresse sans source a la fin de la transaction.
    const email = await query<{ id: string }>(
      `with e as (
         insert into emails (company_id, user_id, address, normalized_address, local_part, type, origin)
         values ($1, $2, 'Contact@alan.com', 'contact@alan.com', 'contact', 'generic', 'found')
         returning id
       ), s as (
         insert into email_sources (email_id, kind, url, extraction_method, context_excerpt)
         select id, 'website', 'https://alan.com/contact', 'mailto', 'Ecrivez-nous' from e
       )
       select id from e`,
      [entreprise.rows[0]?.id, proprietaire],
    );
    const emailId = email.rows[0]?.id;
    await query(
      `insert into verifications (email_id, level, status, reason, address)
       values ($1, 5, 'unverified', 'Controles locaux passes.', 'contact@alan.com')`,
      [emailId],
    );
  }

  it('rend les adresses, leurs sources et leurs verifications (F-104)', async () => {
    await importerAlan(userId);
    await adresseAlan(userId);

    const reponse = await request(app).get('/api/account/export');

    expect(reponse.body.emails).toEqual([
      expect.objectContaining({
        address: 'Contact@alan.com',
        type: 'generic',
        origin: 'found',
        status: 'unverified',
      }),
    ]);
    const emailId = reponse.body.emails[0].id as string;
    expect(reponse.body.emailSources).toEqual([
      expect.objectContaining({
        email_id: emailId,
        kind: 'website',
        url: 'https://alan.com/contact',
        extraction_method: 'mailto',
      }),
    ]);
    expect(reponse.body.verifications).toEqual([
      expect.objectContaining({ email_id: emailId, level: 5, status: 'unverified' }),
    ]);
  });

  it('ne rend rien des autres comptes', async () => {
    const autre = await createUser();
    await importerAlan(autre);
    await adresseAlan(autre);

    const reponse = await request(app).get('/api/account/export');

    expect(reponse.body.imports).toEqual([]);
    expect(reponse.body.companies).toEqual([]);
    expect(reponse.body.emails).toEqual([]);
    expect(reponse.body.emailSources).toEqual([]);
    expect(reponse.body.verifications).toEqual([]);
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
