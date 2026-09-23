import request from 'supertest';
import { pino } from 'pino';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

const silent = pino({ level: 'silent' });

let app: Express;

beforeAll(async () => {
  // La configuration de test est posee par src/test/setup-env.ts, avant tout
  // import : le module de configuration la lit a son premier appel.
  const { createApp } = await import('../app.js');
  app = createApp(silent);
});

describe('GET /health', () => {
  it('repond que le processus est en vie', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok' });
    expect(response.body).toHaveProperty('version');
  });

  it('ne touche aucune dependance, donc repond meme sans base', async () => {
    // Le test lui-meme n'a ni base ni Redis. S'il passe, la promesse tient.
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
  });
});

describe('en-tetes', () => {
  it('pose les en-tetes de securite de helmet (S-09)', async () => {
    const response = await request(app).get('/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers).toHaveProperty('content-security-policy');
  });

  it("n'annonce pas la technologie du serveur", async () => {
    const response = await request(app).get('/health');
    expect(response.headers).not.toHaveProperty('x-powered-by');
  });

  it('renvoie un identifiant de requete', async () => {
    const response = await request(app).get('/health');
    expect(response.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/);
  });

  it("reprend l'identifiant de requete fourni par l'amont", async () => {
    const response = await request(app).get('/health').set('x-request-id', 'trace-abc');
    expect(response.headers['x-request-id']).toBe('trace-abc');
  });
});

describe('route inconnue', () => {
  it('repond 404 au format problem+json', async () => {
    const response = await request(app).get('/route-qui-nexiste-pas');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({
      status: 404,
      code: 'not_found',
      title: 'Ressource introuvable',
    });
  });

  it("joint l'identifiant de requete au probleme", async () => {
    const response = await request(app).get('/absent').set('x-request-id', 'trace-xyz');
    expect(response.body).toMatchObject({ requestId: 'trace-xyz' });
  });
});

describe('erreur inattendue', () => {
  it('ne laisse jamais fuir le message interne (S-03)', async () => {
    // Application minimale montee a la main : dans createApp, le gestionnaire
    // de route inconnue est pose avant toute route ajoutee apres coup, et
    // repondrait 404 au lieu de laisser l'erreur remonter.
    const { default: express } = await import('express');
    const { pinoHttp } = await import('pino-http');
    const { errorHandler } = await import('./middleware/error-handler.js');

    const faulty = express();
    faulty.use(pinoHttp({ logger: silent }));
    faulty.get('/boum', () => {
      throw new Error('chaine de connexion secrete postgres://qui-ne-doit-pas-fuir');
    });
    faulty.use(errorHandler);

    const response = await request(faulty).get('/boum');

    expect(response.status).toBe(500);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({ code: 'internal_error' });
    expect(JSON.stringify(response.body)).not.toContain('postgres://');
  });

  it('traduit une AppError en reponse portant son code', async () => {
    const { default: express } = await import('express');
    const { pinoHttp } = await import('pino-http');
    const { errorHandler } = await import('./middleware/error-handler.js');
    const { AppError } = await import('./problem.js');

    const app400 = express();
    app400.use(pinoHttp({ logger: silent }));
    app400.get('/refus', () => {
      throw AppError.badRequest('csv_too_large', 'Fichier trop volumineux', '5 Mo au plus.');
    });
    app400.use(errorHandler);

    const response = await request(app400).get('/refus');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'csv_too_large',
      title: 'Fichier trop volumineux',
      detail: '5 Mo au plus.',
    });
  });
});
