import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRedisGate } from './politeness.js';

/**
 * La file par domaine telle qu'elle tourne en production : dans Redis,
 * partagee par tous les processus de traitement. Deux clients Redis distincts
 * jouent ici deux processus.
 */
const url = process.env.TEST_REDIS_URL;
const PREFIXE = `mailfind-test:${String(process.pid)}`;

describe.skipIf(url === undefined || url === '')('createRedisGate', () => {
  let premier: Redis;
  let second: Redis;

  beforeAll(() => {
    premier = new Redis(url ?? '');
    second = new Redis(url ?? '');
  });

  afterAll(async () => {
    const cles = await premier.keys(`${PREFIXE}:*`);
    if (cles.length > 0) await premier.del(...cles);
    premier.disconnect();
    second.disconnect();
  });

  it('fait attendre un processus quand un autre tient le domaine', async () => {
    const a = createRedisGate(premier, { prefix: PREFIXE, holdMs: 5000 });
    const b = createRedisGate(second, { prefix: PREFIXE, holdMs: 5000 });
    const periodes: [number, number][] = [];
    const tache = async () => {
      const debut = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 100));
      periodes.push([debut, Date.now()]);
    };

    await Promise.all([
      a.run('exemple.fr', 300, tache),
      b.run('exemple.fr', 300, tache),
      a.run('exemple.fr', 300, tache),
    ]);

    periodes.sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < periodes.length; i += 1) {
      const fin = periodes[i - 1]?.[1] ?? 0;
      const debut = periodes[i]?.[0] ?? 0;
      // Jamais deux a la fois, et l'intervalle entre la fin et le debut.
      expect(debut - fin).toBeGreaterThanOrEqual(300 - 5);
    }
  });

  it('ne bloque pas un domaine pour un autre', async () => {
    const a = createRedisGate(premier, { prefix: PREFIXE, holdMs: 5000 });
    const b = createRedisGate(second, { prefix: PREFIXE, holdMs: 5000 });
    const debut = Date.now();
    await Promise.all([
      a.run('un.fr', 1000, () => Promise.resolve()),
      b.run('deux.fr', 1000, () => Promise.resolve()),
    ]);
    expect(Date.now() - debut).toBeLessThan(500);
  });

  it('libere seul un domaine dont le processus est mort en le tenant', async () => {
    // Un processus prend le verrou et disparait sans le rendre.
    await premier.set(`${PREFIXE}:politesse:orphelin.fr`, 'processus-mort', 'PX', 400);
    const b = createRedisGate(second, { prefix: PREFIXE, holdMs: 5000 });

    const debut = Date.now();
    await b.run('orphelin.fr', 100, () => Promise.resolve());
    const attente = Date.now() - debut;
    expect(attente).toBeGreaterThanOrEqual(350);
    expect(attente).toBeLessThan(1500);
  });

  it('rend le domaine meme quand la tache echoue', async () => {
    const a = createRedisGate(premier, { prefix: PREFIXE, holdMs: 5000 });
    await expect(
      a.run('panne.fr', 100, () => Promise.reject(new Error('page illisible'))),
    ).rejects.toThrow('page illisible');

    const debut = Date.now();
    await a.run('panne.fr', 100, () => Promise.resolve());
    expect(Date.now() - debut).toBeLessThan(1000);
  });
});
