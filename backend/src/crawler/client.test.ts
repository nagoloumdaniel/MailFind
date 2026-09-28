import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFetcher, type Fetcher } from '../net/safe-fetch.js';
import { startTestSites, type TestSites } from '../test/sites/server.js';
import { createCrawlerClient, rulesForStatus, type CrawlerClient } from './client.js';
import { createMemoryGate } from './politeness.js';

const INTERVALLE = 300;
const AGENT = 'MailFindBot/0.1 (+https://mailfind.app/bot)';

let sites: TestSites;
let fetcher: Fetcher;
let client: CrawlerClient;

beforeAll(async () => {
  sites = await startTestSites([
    'acme.test',
    'robots.test',
    'ferme.test',
    'panne.test',
    'libre.test',
  ]);
  fetcher = createFetcher({ testRouting: sites });
});

beforeEach(() => {
  // Un client neuf par test : son cache de robots.txt ne doit pas relier deux
  // tests entre eux.
  client = createCrawlerClient({
    fetcher,
    gate: createMemoryGate(),
    userAgent: AGENT,
    minIntervalMs: INTERVALLE,
  });
  sites.requests.length = 0;
});

afterAll(async () => {
  await fetcher.close();
  await sites.close();
});

function demandes(hote: string): string[] {
  return sites.requests.filter((requete) => requete.host === hote).map((requete) => requete.path);
}

function ecarts(hote: string): number[] {
  const instants = sites.requests
    .filter((requete) => requete.host === hote)
    .map((requete) => requete.at);
  return instants.slice(1).map((instant, index) => instant - (instants[index] ?? 0));
}

describe('robots.txt (F-403)', () => {
  it('ne demande jamais une page que robots.txt interdit a MailFind', async () => {
    expect((await client.get('https://robots.test/interdit')).kind).toBe('disallowed');
    expect((await client.get('https://robots.test/interdit/public')).kind).toBe('page');
    expect((await client.get('https://robots.test/prive')).kind).toBe('page');

    expect(demandes('robots.test')).toEqual(['/robots.txt', '/interdit/public', '/prive']);
  });

  it('ne visite rien d un site qui interdit tout, pas meme l accueil (A6)', async () => {
    for (const chemin of ['/', '/contact', '/mentions-legales']) {
      expect((await client.get(`https://ferme.test${chemin}`)).kind).toBe('disallowed');
    }
    expect(demandes('ferme.test')).toEqual(['/robots.txt']);
  });

  it('ne visite rien quand robots.txt est en panne', async () => {
    expect((await client.get('https://panne.test/')).kind).toBe('disallowed');
    expect(demandes('panne.test')).toEqual(['/robots.txt']);
  });

  it('visite librement un site sans robots.txt', async () => {
    expect((await client.get('https://libre.test/contact')).kind).toBe('page');
  });

  it('ne relit pas robots.txt a chaque page', async () => {
    await client.get('https://libre.test/');
    await client.get('https://libre.test/contact');
    expect(demandes('libre.test').filter((chemin) => chemin === '/robots.txt')).toHaveLength(1);
  });
});

describe('politesse (F-405)', () => {
  it('espace les requetes sur un meme domaine', async () => {
    await client.get('https://libre.test/');
    await client.get('https://libre.test/contact');
    await client.get('https://libre.test/');

    for (const ecart of ecarts('libre.test')) expect(ecart).toBeGreaterThanOrEqual(INTERVALLE - 5);
  });

  it('n envoie jamais deux requetes a la fois au meme domaine', async () => {
    await Promise.all([
      client.get('https://libre.test/__pause?ms=150'),
      client.get('https://libre.test/__pause?ms=150'),
      client.get('https://libre.test/__pause?ms=150'),
    ]);

    // robots.txt n'est demande qu'une fois, meme par trois pages simultanees.
    expect(demandes('libre.test').filter((chemin) => chemin === '/robots.txt')).toHaveLength(1);
    // Chaque requete attend la fin de la precedente, plus l'intervalle.
    const pauses = ecarts('libre.test').slice(1);
    expect(pauses).toHaveLength(2);
    for (const ecart of pauses) expect(ecart).toBeGreaterThanOrEqual(150 + INTERVALLE - 5);
  });

  it('honore un Crawl-delay plus long que l intervalle', async () => {
    await client.get('https://acme.test/');
    await client.get('https://acme.test/');
    await client.get('https://acme.test/');

    const pages = ecarts('acme.test').slice(1);
    for (const ecart of pages) expect(ecart).toBeGreaterThanOrEqual(600 - 5);
  });

  it('ne fait pas attendre un domaine pour un autre', async () => {
    const debut = Date.now();
    await Promise.all([client.get('https://libre.test/'), client.get('https://robots.test/')]);
    expect(Date.now() - debut).toBeLessThan(INTERVALLE * 2);
  });
});

describe('echecs', () => {
  it('rend un echec de connexion, sans rien demander, quand le site ne repond pas', async () => {
    // « .invalid » est reserve : ce nom ne se resout nulle part.
    const issue = await client.get('https://mailfind-test.invalid/contact');
    expect(issue).toMatchObject({ kind: 'failed', reason: expect.stringMatching(/injoignable/) });
  });

  it('dit « injoignable » et non « interdit » quand robots.txt est en panne', async () => {
    expect(await client.get('https://panne.test/')).toEqual({
      kind: 'disallowed',
      because: 'unreachable',
    });
    expect(await client.get('https://robots.test/interdit')).toEqual({
      kind: 'disallowed',
      because: 'robots',
    });
  });

  it('rend le motif d une page illisible au lieu de lever', async () => {
    const issue = await client.get('https://libre.test/__enorme');
    expect(issue).toMatchObject({ kind: 'failed', reason: expect.stringMatching(/volumineuse/) });
  });
});

describe('rulesForStatus', () => {
  it('suit la RFC 9309 selon le code de robots.txt', () => {
    expect(rulesForStatus(404, '', 'mailfindbot').isAllowed('/x')).toBe(true);
    expect(rulesForStatus(403, '', 'mailfindbot').isAllowed('/x')).toBe(true);
    expect(rulesForStatus(500, '', 'mailfindbot').isAllowed('/x')).toBe(false);
    expect(rulesForStatus(429, '', 'mailfindbot').isAllowed('/x')).toBe(false);
    expect(rulesForStatus(200, 'User-agent: *\nDisallow: /x', 'mailfindbot').isAllowed('/x')).toBe(
      false,
    );
  });
});
