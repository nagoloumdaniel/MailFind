import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBraveSearch, WebSearchError } from './web-search.js';

let serveur: Server;
let base: string;
let dernier: { url: string; cle: string | undefined } | undefined;

beforeAll(async () => {
  serveur = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const cle = req.headers['x-subscription-token'];
    dernier = { url: url.toString(), cle: typeof cle === 'string' ? cle : undefined };
    if (cle !== 'cle-valide') {
      res.writeHead(401);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.searchParams.get('q') === 'vide') {
      res.end(JSON.stringify({ type: 'search' }));
      return;
    }
    res.end(
      JSON.stringify({
        web: {
          results: [{ url: 'https://www.doctolib.fr/', title: 'Doctolib', description: 'RDV' }],
        },
      }),
    );
  });
  await new Promise<void>((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((serveur.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => serveur.close(() => resolve()));
});

describe('createBraveSearch (D-07)', () => {
  it('interroge l API officielle avec la cle, en francais, et rend les resultats', async () => {
    const brave = createBraveSearch({ apiKey: 'cle-valide', baseUrl: base });
    const resultats = await brave.search('Doctolib');

    expect(resultats).toEqual([
      { url: 'https://www.doctolib.fr/', title: 'Doctolib', description: 'RDV' },
    ]);
    const appel = new URL(dernier?.url ?? '');
    expect(appel.pathname).toBe('/res/v1/web/search');
    expect(appel.searchParams.get('country')).toBe('fr');
    expect(dernier?.cle).toBe('cle-valide');
  });

  it('rend une liste vide quand la reponse ne porte pas de resultats web', async () => {
    const brave = createBraveSearch({ apiKey: 'cle-valide', baseUrl: base });
    expect(await brave.search('vide')).toEqual([]);
  });

  it('leve sur une cle refusee, avec le code', async () => {
    const brave = createBraveSearch({ apiKey: 'mauvaise', baseUrl: base });
    await expect(brave.search('Doctolib')).rejects.toMatchObject({
      name: 'WebSearchError',
      status: 401,
    });
    expect(WebSearchError).toBeDefined();
  });
});
