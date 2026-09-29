import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import { loadDisposableDomains, refreshDisposableDomains } from './disposable.js';

let serveur: Server;
let base: string;

beforeAll(async () => {
  serveur = createServer((req, res) => {
    if (req.url === '/complete') {
      res.end(Array.from({ length: 1500 }, (_, i) => `jetable${String(i)}.example`).join('\n'));
    } else if (req.url === '/tronquee') {
      res.end('jetable1.example\njetable2.example\n');
    } else {
      res.writeHead(503);
      res.end();
    }
  });
  await new Promise<void>((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((serveur.address() as AddressInfo).port)}`;
});

beforeEach(async () => {
  await query('truncate disposable_domains');
});

afterAll(async () => {
  await new Promise<void>((resolve) => serveur.close(() => resolve()));
  await closePool();
});

describe('refreshDisposableDomains (niveau 4)', () => {
  it('remplace la liste par la liste publique', async () => {
    expect(await refreshDisposableDomains({ url: `${base}/complete` })).toEqual({
      kind: 'refreshed',
      count: 1500,
    });
    const domaines = await loadDisposableDomains();
    expect(domaines.has('jetable42.example')).toBe(true);
    // La liste de base reste, meme apres un rechargement.
    expect(domaines.has('yopmail.com')).toBe(true);
  });

  it('garde la liste en place quand le telechargement est tronque ou echoue', async () => {
    await refreshDisposableDomains({ url: `${base}/complete` });
    expect((await refreshDisposableDomains({ url: `${base}/tronquee` })).kind).toBe('kept');
    expect((await refreshDisposableDomains({ url: `${base}/panne` })).kind).toBe('kept');
    const lignes = await query<{ n: number }>('select count(*)::int as n from disposable_domains');
    expect(lignes.rows[0]?.n).toBe(1500);
  });
});
