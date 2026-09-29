import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFetcher, type Fetcher } from '../net/safe-fetch.js';
import { startTestSites, type TestSites } from '../test/sites/server.js';
import { createCrawlerClient, type CrawlerClient } from './client.js';
import { crawlCompany } from './engine.js';
import { createMemoryGate } from './politeness.js';
import { appearsIn } from './verify.js';

let sites: TestSites;
let fetcher: Fetcher;
let client: CrawlerClient;

beforeAll(async () => {
  sites = await startTestSites([
    'boulangerie.test',
    'spa.test',
    'ferme.test',
    'absent.test',
    'panne.test',
    // Seul www.ecole.test repond : ecole.test n'est pas aiguille, sa connexion echoue.
    'www.ecole.test',
    // Aiguille pour qu'une visite, si elle avait lieu, soit notee.
    'www.ferme.test',
  ]);
  fetcher = createFetcher({ testRouting: sites });
});

beforeEach(() => {
  client = createCrawlerClient({
    fetcher,
    gate: createMemoryGate(),
    userAgent: 'MailFindBot/0.1 (+https://mailfind.app/bot)',
    minIntervalMs: 20,
  });
  sites.requests.length = 0;
});

afterAll(async () => {
  await fetcher.close();
  await sites.close();
});

const adresses = (rapport: Awaited<ReturnType<typeof crawlCompany>>) =>
  rapport.addresses.map((a) => `${a.normalized} ${a.method} ${new URL(a.pageUrl).pathname}`).sort();

describe('crawlCompany sur un site de boulangerie', () => {
  it('releve en profondeur standard les adresses publiees, chacune avec sa page (F-411)', async () => {
    const rapport = await crawlCompany(client, { domain: 'boulangerie.test', depth: 'standard' });

    expect(adresses(rapport)).toEqual([
      'boulangerie.martin.lyon@gmail.com text /mentions-legales',
      'contact@boulangerie.test mailto /contact',
      'info@boulangerie.test json_ld /a-propos',
      'recrutement@boulangerie.test written_form /recrutement',
      'rh@boulangerie.test text /contact',
    ]);
  });

  it('cite pour chaque adresse une page ou elle figure vraiment (DoD Phase 3)', async () => {
    const rapport = await crawlCompany(client, { domain: 'boulangerie.test', depth: 'deep' });
    expect(rapport.addresses.length).toBeGreaterThan(0);
    for (const trouvee of rapport.addresses) {
      const page = await fetcher.fetchPage(trouvee.pageUrl);
      expect(
        appearsIn(page.body, trouvee.address),
        `${trouvee.address} sur ${trouvee.pageUrl}`,
      ).toBe(true);
    }
  });

  it('ecarte l hebergeur, l exemple et le nom de fichier (F-410)', async () => {
    const rapport = await crawlCompany(client, { domain: 'boulangerie.test', depth: 'standard' });
    const toutes = rapport.addresses.map((a) => a.normalized);
    expect(toutes).not.toContain('support@ovh.com');
    expect(toutes.some((a) => a.includes('png') || a.includes('exemple'))).toBe(false);
  });

  it('ne demande jamais la page que robots.txt interdit, et le note', async () => {
    const rapport = await crawlCompany(client, { domain: 'boulangerie.test', depth: 'standard' });
    expect(sites.requests.some((r) => r.path.startsWith('/prive'))).toBe(false);
    expect(rapport.notes).toContain('robots_disallowed');
    expect(rapport.addresses.some((a) => a.normalized.startsWith('secret@'))).toBe(false);
  });

  it('note l adresse masquee sans la decoder, et propose le formulaire (F-407, F-408)', async () => {
    const rapport = await crawlCompany(client, { domain: 'boulangerie.test', depth: 'standard' });
    expect(rapport.notes).toEqual(expect.arrayContaining(['masked_address', 'contact_form']));
    expect(rapport.contactFormUrl).toBe('https://boulangerie.test/contact');
  });

  it('releve la page carrieres, le standard et LinkedIn', async () => {
    const rapport = await crawlCompany(client, { domain: 'boulangerie.test', depth: 'standard' });
    expect(rapport.careersUrl).toBe('https://boulangerie.test/recrutement');
    expect(rapport.phone).toBe('+33478000000');
    expect(rapport.linkedinUrl).toBe('https://www.linkedin.com/company/boulangerie-martin');
  });

  it('se limite a l accueil et au contact en profondeur rapide (F-402)', async () => {
    const rapport = await crawlCompany(client, { domain: 'boulangerie.test', depth: 'quick' });
    expect(rapport.pages.map((p) => new URL(p.url).pathname)).toEqual(['/', '/contact']);
    expect(adresses(rapport)).toEqual([
      'contact@boulangerie.test mailto /contact',
      'rh@boulangerie.test text /contact',
    ]);
  });

  it('va chercher les pages sans mot cle en profondeur approfondie', async () => {
    const rapport = await crawlCompany(client, { domain: 'boulangerie.test', depth: 'deep' });
    expect(adresses(rapport)).toContain('commandes@boulangerie.test text /produits');
    expect(rapport.pages.length).toBeLessThanOrEqual(25);
  });

  it('respecte le plafond de pages, accueil et page interdite compris', async () => {
    const rapport = await crawlCompany(client, { domain: 'boulangerie.test', depth: 'standard' });
    expect(rapport.pages.length).toBeLessThanOrEqual(10);
  });
});

describe('crawlCompany, sites difficiles', () => {
  it('signale un site construit en JavaScript au lieu de le dire vide (F-412)', async () => {
    const rapport = await crawlCompany(client, { domain: 'spa.test', depth: 'standard' });
    expect(rapport.notes).toContain('dynamic_content');
    expect(rapport.addresses).toEqual([]);
  });

  it('ne visite rien d un site qui interdit tout (A6)', async () => {
    const rapport = await crawlCompany(client, { domain: 'ferme.test', depth: 'deep' });
    expect(rapport.notes).toEqual(['robots_disallowed']);
    expect(sites.requests.filter((r) => r.host === 'ferme.test').map((r) => r.path)).toEqual([
      '/robots.txt',
    ]);
  });

  it('dit injoignable, et non interdit, un site dont robots.txt est en panne', async () => {
    const rapport = await crawlCompany(client, { domain: 'panne.test', depth: 'standard' });
    expect(rapport.notes).toEqual(['unreachable']);
    expect(sites.requests.filter((r) => r.host === 'panne.test').map((r) => r.path)).toEqual([
      '/robots.txt',
    ]);
  });

  it('dit qu un site est injoignable plutot que vide', async () => {
    const rapport = await crawlCompany(client, { domain: 'absent.test', depth: 'standard' });
    expect(rapport.notes).toEqual(['unreachable']);
    expect(rapport.pages.every((p) => p.outcome === 'failed')).toBe(true);
  });

  it('essaie www quand le domaine nu ne repond pas', async () => {
    const rapport = await crawlCompany(client, { domain: 'ecole.test', depth: 'quick' });
    expect(rapport.notes).not.toContain('unreachable');
    expect(rapport.addresses.map((a) => a.pageUrl)).toEqual(['https://www.ecole.test/']);
  });

  it('n essaie pas www quand le domaine nu a repondu, meme pour refuser', async () => {
    await crawlCompany(client, { domain: 'ferme.test', depth: 'quick' });
    expect(sites.requests.some((r) => r.host === 'www.ferme.test')).toBe(false);
  });

  it('part du site donne par l import quand il est sur le domaine', async () => {
    const rapport = await crawlCompany(client, {
      domain: 'boulangerie.test',
      websiteUrl: 'https://boulangerie.test/contact',
      depth: 'quick',
    });
    expect(new URL(rapport.pages[0]?.url ?? '').pathname).toBe('/contact');
  });
});
