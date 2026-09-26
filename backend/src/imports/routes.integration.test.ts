import type { Express, RequestHandler } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closePool, query } from '../db/pool.js';
import { createUser, resetData } from '../test/integration/db.js';
import { createTestSession } from '../test/session.js';

// La file est une infrastructure : ce qui compte ici est que l'import soit
// enregistre tel que l'utilisateur l'a regle, puis confie a la file.
vi.mock('../queue/queues.js', () => ({ enqueueImportPlan: vi.fn(() => Promise.resolve()) }));
const { enqueueImportPlan } = await import('../queue/queues.js');

let app: Express;
let userId: string;

beforeAll(async () => {
  const { createApp } = await import('../app.js');
  const base = createTestSession();
  // Une session deja connectee : la connexion Google est testee ailleurs.
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
  vi.mocked(enqueueImportPlan).mockClear();
  userId = await createUser();
});

afterAll(async () => {
  await closePool();
});

async function agentAvecJeton() {
  const agent = request.agent(app);
  const reponse = await agent.get('/api/auth/me');
  const cookies = reponse.headers['set-cookie'] as unknown as string[];
  const jeton = cookies
    .find((cookie) => cookie.startsWith('mailfind.csrf='))
    ?.split(';')[0]
    ?.slice('mailfind.csrf='.length);
  return { agent, jeton: jeton ?? '' };
}

const FICHIER = {
  filename: 'salon.csv',
  headers: ['Entreprise', 'Site', 'Ville'],
  mapping: ['company_name', 'website_url', 'city'],
  rows: [
    ['Alan', 'https://alan.com', 'Paris'],
    ['', '', 'Lyon'],
  ],
};

describe('POST /api/imports', () => {
  it('enregistre les parametres choisis, et confie l import a la file', async () => {
    const { agent, jeton } = await agentAvecJeton();

    const reponse = await agent
      .post('/api/imports')
      .set('x-csrf-token', jeton)
      .send({
        ...FICHIER,
        settings: {
          depth: 'quick',
          emailTypes: ['recruitment'],
          providers: [],
          tags: ['Salon 2026'],
        },
      });

    expect(reponse.status).toBe(201);
    expect(reponse.body.import).toMatchObject({ totalRows: 2, acceptedRows: 1, rejectedRows: 1 });
    expect(enqueueImportPlan).toHaveBeenCalledWith({ importId: reponse.body.import.id, userId });

    const result = await query<{ settings: Record<string, unknown> }>(
      'select settings from imports where id = $1',
      [reponse.body.import.id],
    );
    expect(result.rows[0]?.settings).toEqual({
      depth: 'quick',
      emailTypes: ['recruitment'],
      providers: [],
      tags: ['salon 2026'],
      columns: { headers: FICHIER.headers, mapping: FICHIER.mapping },
    });
  });

  it('prend les reglages par defaut quand l appel n en donne pas', async () => {
    const { agent, jeton } = await agentAvecJeton();

    const reponse = await agent.post('/api/imports').set('x-csrf-token', jeton).send(FICHIER);

    expect(reponse.status).toBe(201);
    const result = await query<{ settings: Record<string, unknown> }>(
      'select settings from imports where id = $1',
      [reponse.body.import.id],
    );
    expect(result.rows[0]?.settings).toMatchObject({
      depth: 'standard',
      emailTypes: ['recruitment', 'hr', 'generic'],
      providers: ['brave', 'hunter'],
      tags: [],
    });
  });

  it('refuse des parametres inconnus, avec un motif qui les nomme', async () => {
    const { agent, jeton } = await agentAvecJeton();

    const reponse = await agent
      .post('/api/imports')
      .set('x-csrf-token', jeton)
      .send({ ...FICHIER, settings: { depth: 'total' } });

    expect(reponse.status).toBe(400);
    expect(reponse.body).toMatchObject({ code: 'invalid_settings' });
    expect(enqueueImportPlan).not.toHaveBeenCalled();
    expect((await query<{ n: number }>('select count(*)::int as n from imports')).rows[0]?.n).toBe(
      0,
    );
  });

  it('ne laisse pas l appel ecraser les colonnes enregistrees', async () => {
    const { agent, jeton } = await agentAvecJeton();

    const reponse = await agent
      .post('/api/imports')
      .set('x-csrf-token', jeton)
      .send({ ...FICHIER, settings: { columns: { headers: ['x'], mapping: [null] } } });

    expect(reponse.status).toBe(400);
  });
});

describe('GET /api/imports/:id apres planification', () => {
  it('compte les doublons parmi les lignes retenues, et rend le motif d un echec', async () => {
    const { planImport, markImportFailed } = await import('./plan.js');
    const { agent, jeton } = await agentAvecJeton();
    const cree = await agent
      .post('/api/imports')
      .set('x-csrf-token', jeton)
      .send({
        ...FICHIER,
        rows: [...FICHIER.rows, ['Alan SAS', 'www.alan.com', 'Paris']],
      });
    const id = cree.body.import.id as string;

    await planImport(id, userId);
    const detail = await agent.get(`/api/imports/${id}`);

    // Deux lignes retenues, dont une a rejoint Alan : la seconde ne doit pas
    // disparaitre du compte parce qu'elle n'a rien cree.
    expect(detail.body.import).toMatchObject({
      status: 'completed',
      totalRows: 3,
      processedRows: 3,
      acceptedRows: 2,
      duplicateRows: 1,
      rejectedRows: 1,
      error: null,
    });

    await query(`update imports set status = 'planning' where id = $1`, [id]);
    await markImportFailed(id);
    const echec = await agent.get(`/api/imports/${id}`);
    expect(echec.body.import.error).toMatch(/a echoue/);
  });
});

describe('GET /api/imports/:id et annulation', () => {
  it('rend l import avec ses lignes ecartees, puis l annule', async () => {
    const { agent, jeton } = await agentAvecJeton();
    const cree = await agent.post('/api/imports').set('x-csrf-token', jeton).send(FICHIER);
    const id = cree.body.import.id as string;

    const detail = await agent.get(`/api/imports/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.import).toMatchObject({ id, status: 'pending', filename: 'salon.csv' });
    expect(detail.body.rejectedRows).toEqual([{ line: 3, error: expect.any(String) }]);

    const annule = await agent.post(`/api/imports/${id}/cancel`).set('x-csrf-token', jeton);
    expect(annule.status).toBe(200);
    expect(annule.body.import.status).toBe('cancelled');

    const encore = await agent.post(`/api/imports/${id}/cancel`).set('x-csrf-token', jeton);
    expect(encore.status).toBe(400);
    expect(encore.body).toMatchObject({ code: 'import_not_cancellable' });
  });

  it('ne montre pas l import d un autre compte (S-04)', async () => {
    const { agent, jeton } = await agentAvecJeton();
    const cree = await agent.post('/api/imports').set('x-csrf-token', jeton).send(FICHIER);

    userId = await createUser();
    const autre = await agentAvecJeton();

    expect((await autre.agent.get(`/api/imports/${cree.body.import.id}`)).status).toBe(404);
  });
});
