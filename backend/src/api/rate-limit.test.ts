import express from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../http/middleware/error-handler.js';
import { createMemoryRateLimitStore, rateLimit, type RateLimitStore } from './rate-limit.js';

function application(store: RateLimitStore, limit = 2, onStoreError?: (e: unknown) => void) {
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
  app.use((req, _res, next) => {
    req.apiKey = { id: req.get('x-cle') ?? 'a', scopes: [] };
    next();
  });
  app.use(
    rateLimit({
      store: () => store,
      limit,
      ...(onStoreError === undefined ? {} : { onStoreError }),
    }),
  );
  app.get('/', (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

describe('rateLimit (F-1304)', () => {
  it('annonce la limite et ce qui reste, puis refuse au-dela avec Retry-After', async () => {
    let maintenant = 0;
    const app = application(createMemoryRateLimitStore(() => maintenant));

    const premiere = await request(app).get('/');
    expect(premiere.status).toBe(200);
    expect(premiere.headers['ratelimit-limit']).toBe('2');
    expect(premiere.headers['ratelimit-remaining']).toBe('1');
    expect(premiere.headers['ratelimit-reset']).toBe('60');

    maintenant = 15_000;
    await request(app).get('/');
    const refus = await request(app).get('/');
    expect(refus.status).toBe(429);
    expect(refus.body.code).toBe('rate_limited');
    expect(refus.headers['retry-after']).toBe('45');
    expect(refus.headers['ratelimit-remaining']).toBe('0');

    // Une fenetre neuve, un compteur neuf.
    maintenant = 60_000;
    expect((await request(app).get('/')).status).toBe(200);
  });

  it('compte chaque cle a part', async () => {
    const app = application(createMemoryRateLimitStore(), 1);
    expect((await request(app).get('/').set('x-cle', 'a')).status).toBe(200);
    expect((await request(app).get('/').set('x-cle', 'a')).status).toBe(429);
    expect((await request(app).get('/').set('x-cle', 'b')).status).toBe(200);
  });

  it('laisse passer quand le compteur est en panne, et le signale', async () => {
    const pannes: unknown[] = [];
    const enPanne: RateLimitStore = { hit: () => Promise.reject(new Error('redis absent')) };
    const app = application(enPanne, 1, (e) => pannes.push(e));
    expect((await request(app).get('/')).status).toBe(200);
    expect(pannes).toHaveLength(1);
  });
});
