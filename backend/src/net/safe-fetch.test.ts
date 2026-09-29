import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestSites, type TestSites } from '../test/sites/server.js';
import {
  BlockedAddressError,
  createFetcher,
  FetchTimeoutError,
  PageTooLargeError,
  type Fetcher,
} from './safe-fetch.js';

let sites: TestSites;
let client: Fetcher;

beforeAll(async () => {
  sites = await startTestSites(['acme.test', 'ailleurs.test', 'encore.test', 'loin.test']);
  client = createFetcher({ testRouting: sites });
});

afterAll(async () => {
  await client.close();
  await sites.close();
});

describe('postJson, le chemin des webhooks (S-05)', () => {
  it('poste sur une adresse publique et rend le statut', async () => {
    const reponse = await client.postJson('https://acme.test/__erreur?code=202', '{}', {
      'mailfind-signature': 't=1,v1=ab',
    });
    expect(reponse.status).toBe(202);
    expect(sites.requests.at(-1)?.path).toBe('/__erreur?code=202');
  });

  it('refuse la machine locale et les adresses de metadonnees', async () => {
    for (const url of [
      'http://127.0.0.1/hook',
      'http://localhost/hook',
      'http://169.254.169.254/latest',
    ]) {
      await expect(client.postJson(url, '{}', {}), url).rejects.toBeInstanceOf(BlockedAddressError);
    }
  });

  it('ne suit pas une redirection : le 3xx est rendu tel quel', async () => {
    const avant = sites.requests.length;
    const reponse = await client.postJson(
      'https://acme.test/__redirection?vers=http://169.254.169.254/',
      '{}',
      {},
    );
    expect(reponse.status).toBe(302);
    expect(sites.requests.length).toBe(avant + 1);
  });
});

describe('createFetcher', () => {
  it('lit une page et rend l URL telle que le site la connait', async () => {
    const page = await client.fetchPage('https://acme.test/');

    expect(page.status).toBe(200);
    expect(page.url).toBe('https://acme.test/');
    expect(page.body).toContain('<h1>Acme</h1>');
  });

  it('s annonce avec l agent de MailFind (F-404)', async () => {
    await client.fetchPage('https://acme.test/');
    expect(sites.requests.at(-1)?.userAgent).toMatch(/^MailFindBot\//);
  });

  it('refuse la machine locale, meme sur le client qui sert les tests (S-05)', async () => {
    for (const url of [
      `http://127.0.0.1:${String(sites.port)}/`,
      `http://localhost:${String(sites.port)}/`,
      `http://[::ffff:127.0.0.1]:${String(sites.port)}/`,
    ]) {
      await expect(client.fetchPage(url), url).rejects.toBeInstanceOf(BlockedAddressError);
    }
  });

  it('refuse une redirection vers une adresse privee', async () => {
    const vers = encodeURIComponent('http://169.254.169.254/latest/meta-data/');
    await expect(
      client.fetchPage(`https://acme.test/__redirection?vers=${vers}`),
    ).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it('refuse une redirection vers un autre protocole', async () => {
    const vers = encodeURIComponent('file:///etc/passwd');
    await expect(client.fetchPage(`https://acme.test/__redirection?vers=${vers}`)).rejects.toThrow(
      /protocole file: refuse/,
    );
  });

  it('suit une redirection interne et dit ou il est arrive', async () => {
    const page = await client.fetchPage('https://acme.test/__redirection?vers=/');
    expect(page.url).toBe('https://acme.test/');
    expect(page.redirects).toBe(1);
  });

  it('borne les redirections hors du domaine (F-405)', async () => {
    const troisieme = encodeURIComponent('https://loin.test/');
    const deuxieme = encodeURIComponent(`https://encore.test/__redirection?vers=${troisieme}`);
    const premiere = `https://acme.test/__redirection?vers=${encodeURIComponent(
      `https://ailleurs.test/__redirection?vers=${deuxieme}`,
    )}`;

    await expect(client.fetchPage(premiere)).rejects.toThrow(/hors du domaine/);
    const deux = await client.fetchPage(premiere, { maxOffDomainRedirects: 3 });
    expect(deux.url).toBe('https://loin.test/');
  });

  it('abandonne une page trop volumineuse sans la charger (F-405)', async () => {
    await expect(client.fetchPage('https://acme.test/__enorme')).rejects.toBeInstanceOf(
      PageTooLargeError,
    );
  });

  it('abandonne une page qui distille ses octets, au bout du delai global', async () => {
    const debut = Date.now();
    await expect(
      client.fetchPage('https://acme.test/__lent', { timeoutMs: 1200 }),
    ).rejects.toBeInstanceOf(FetchTimeoutError);
    expect(Date.now() - debut).toBeLessThan(3000);
  });

  it('ne lit pas ce qui n est pas une page', async () => {
    const page = await client.fetchPage('https://acme.test/plaquette.pdf');
    expect(page.status).toBe(200);
    expect(page.body).toBe('');
  });

  it('decode une page en Windows-1252', async () => {
    const page = await client.fetchPage('https://acme.test/__latin1');
    expect(page.body).toContain('Société Générale');
  });

  it('ne s active pas en production', () => {
    const avant = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => createFetcher({ testRouting: sites })).toThrow(/production/);
    } finally {
      process.env.NODE_ENV = avant;
    }
  });
});
