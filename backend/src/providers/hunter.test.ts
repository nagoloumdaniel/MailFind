import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProviderError } from './enrichment.js';
import { createHunter } from './hunter.js';

/** Des reponses au format de l'API Hunter v2, servies en local. */
const REPONSES: Record<string, { status: number; corps?: unknown }> = {
  'acme.fr': {
    status: 200,
    corps: {
      data: {
        domain: 'acme.fr',
        pattern: '{first}.{last}',
        organization: 'Acme',
        emails: [
          {
            value: 'jean.dupont@acme.fr',
            type: 'personal',
            confidence: 94,
            first_name: 'Jean',
            last_name: 'Dupont',
            position: 'Directeur des ressources humaines',
            sources: [
              { domain: 'acme.fr', uri: 'https://acme.fr/equipe', extracted_on: '2026-01-02' },
            ],
          },
          { value: 'contact@acme.fr', type: 'generic', confidence: 88, sources: [] },
          { value: 42 },
        ],
      },
      meta: { results: 2 },
    },
  },
  'vide.fr': { status: 200, corps: { data: { domain: 'vide.fr', pattern: null, emails: [] } } },
  'refuse.fr': { status: 451, corps: { errors: [{ id: 'unavailable_for_legal_reasons' }] } },
  'quota.fr': { status: 429, corps: { errors: [{ id: 'too_many_requests' }] } },
  'casse.fr': { status: 200, corps: { rien: true } },
};

let serveur: Server;
let base: string;
const recues: { url: string; cle: string | undefined }[] = [];

beforeAll(async () => {
  serveur = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const cle = req.headers['x-api-key'];
    recues.push({ url: url.toString(), cle: typeof cle === 'string' ? cle : undefined });
    if (cle !== 'cle-valide') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ errors: [{ id: 'authentication_failed' }] }));
      return;
    }
    const reponse = REPONSES[url.searchParams.get('domain') ?? ''] ?? { status: 500 };
    res.writeHead(reponse.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reponse.corps ?? {}));
  });
  await new Promise<void>((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((serveur.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => serveur.close(() => resolve()));
});

const hunter = (cle = 'cle-valide') => createHunter({ apiKey: cle, baseUrl: base });

describe('createHunter (F-602)', () => {
  it('rend les adresses du domaine, leur nature, leur source et le format observe', async () => {
    const resultat = await hunter().domainSearch('acme.fr');
    expect(resultat).toEqual({
      domain: 'acme.fr',
      pattern: '{first}.{last}',
      emails: [
        {
          address: 'jean.dupont@acme.fr',
          kind: 'personal',
          confidence: 94,
          firstName: 'Jean',
          lastName: 'Dupont',
          position: 'Directeur des ressources humaines',
          sourceUrls: ['https://acme.fr/equipe'],
        },
        { address: 'contact@acme.fr', kind: 'generic', confidence: 88, sourceUrls: [] },
      ],
    });
  });

  it('passe la cle dans un en-tete, jamais dans l URL (S-03)', async () => {
    await hunter().domainSearch('acme.fr');
    const derniere = recues.at(-1);
    expect(derniere?.cle).toBe('cle-valide');
    expect(derniere?.url).not.toContain('cle-valide');
    expect(derniere?.url).not.toContain('api_key');
  });

  it('rend une liste vide pour un domaine sans adresse connue', async () => {
    expect(await hunter().domainSearch('vide.fr')).toEqual({ domain: 'vide.fr', emails: [] });
  });

  it('classe chaque refus pour que le pipeline sache quoi en faire (F-606)', async () => {
    await expect(hunter('mauvaise').domainSearch('acme.fr')).rejects.toMatchObject({
      kind: 'auth',
    });
    await expect(hunter().domainSearch('quota.fr')).rejects.toMatchObject({ kind: 'quota' });
    await expect(hunter().domainSearch('refuse.fr')).rejects.toMatchObject({ kind: 'refused' });
    await expect(hunter().domainSearch('inconnu.fr')).rejects.toMatchObject({
      kind: 'unavailable',
      status: 500,
    });
  });

  it('refuse une reponse illisible plutot que de la croire vide', async () => {
    await expect(hunter().domainSearch('casse.fr')).rejects.toBeInstanceOf(ProviderError);
  });

  it('dit injoignable quand Hunter ne repond pas', async () => {
    const absent = createHunter({ apiKey: 'x', baseUrl: 'http://127.0.0.1:1', timeoutMs: 2000 });
    await expect(absent.domainSearch('acme.fr')).rejects.toMatchObject({ kind: 'unavailable' });
  });
});
