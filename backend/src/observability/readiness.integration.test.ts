import type { Express } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool } from '../db/pool.js';
import { closeQueueConnection, getQueueConnection } from '../queue/connection.js';
import { createTestSession } from '../test/session.js';
import { checkReadiness, HEARTBEAT_KEY, writeWorkerHeartbeat } from './readiness.js';

/**
 * `/ready` parle a la base et a Redis : sans Redis, il n'y a rien a prouver,
 * et le test se saute plutot que de mentir.
 */
const AVEC_REDIS = (process.env.TEST_REDIS_URL ?? '') !== '';
let app: Express;

beforeAll(async () => {
  const { createApp } = await import('../app.js');
  app = createApp({ logger: pino({ level: 'silent' }), session: createTestSession() });
});

afterAll(async () => {
  if (AVEC_REDIS) await closeQueueConnection();
  await closePool();
});

describe.skipIf(!AVEC_REDIS)('/ready (section 12)', () => {
  it('repond 200 quand la base et Redis repondent', async () => {
    await writeWorkerHeartbeat();

    const reponse = await request(app).get('/ready');

    expect(reponse.status).toBe(200);
    expect(reponse.body.ready).toBe(true);
    const sondes = Object.fromEntries(
      (reponse.body.checks as { name: string; status: string }[]).map((c) => [c.name, c.status]),
    );
    expect(sondes).toMatchObject({ database: 'ok', redis: 'ok', queues: 'ok', worker: 'ok' });
  });

  it('rend la profondeur de chaque file', async () => {
    const rapport = await checkReadiness(process.env.BULLMQ_PREFIX ?? 'mailfind:bull');

    expect(rapport.queues.map((file) => file.name).sort()).toEqual([
      'company',
      'import',
      'maintenance',
    ]);
    for (const file of rapport.queues) {
      expect(file.waiting).toBeGreaterThanOrEqual(0);
      expect(file.active).toBeGreaterThanOrEqual(0);
    }
  });

  it('dit le processus de traitement silencieux, sans se declarer en panne', async () => {
    await getQueueConnection().del(HEARTBEAT_KEY);

    const reponse = await request(app).get('/ready');

    // L'API repond encore : un processus arrete ne doit pas faire retirer
    // l'instance du service.
    expect(reponse.status).toBe(200);
    expect(reponse.body.ready).toBe(true);
    const worker = (
      reponse.body.checks as { name: string; status: string; detail?: string }[]
    ).find((c) => c.name === 'worker');
    expect(worker).toMatchObject({ status: 'degraded' });
    expect(worker?.detail).toContain('en attente');
    expect(reponse.body.workerSeenAt).toBeNull();
  });

  it('ecrit un battement qui expire, et que la sonde relit', async () => {
    await writeWorkerHeartbeat();

    const ttl = await getQueueConnection().ttl(HEARTBEAT_KEY);

    expect(ttl).toBeGreaterThan(0);
    expect(
      (await checkReadiness(process.env.BULLMQ_PREFIX ?? 'mailfind:bull')).workerSeenAt,
    ).not.toBeNull();
  });

  it('ne demande aucune session : une sonde n a pas de compte', async () => {
    const reponse = await request(app).get('/ready');

    expect(reponse.status).not.toBe(401);
  });
});
