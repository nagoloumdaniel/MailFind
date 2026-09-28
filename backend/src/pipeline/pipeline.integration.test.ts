import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCrawlerClient } from '../crawler/client.js';
import { createMemoryGate } from '../crawler/politeness.js';
import { closePool, query } from '../db/pool.js';
import type { KnownField } from '../imports/fields.js';
import { cancelImport, planImport } from '../imports/plan.js';
import { createImport, type PreparedRow } from '../imports/repository.js';
import { validateRow } from '../imports/validate.js';
import { createFetcher, type Fetcher } from '../net/safe-fetch.js';
import type { LegalIdentity } from '../providers/recherche-entreprises.js';
import type { WebResult } from '../providers/web-search.js';
import type { CompanyJob, CompanyStep } from '../queue/queues.js';
import { createUser, resetData } from '../test/integration/db.js';
import { startTestSites, type TestSites } from '../test/sites/server.js';
import { crawlStep, type CrawlDeps } from './crawl.js';
import { identifyCompany, type IdentifyDeps } from './identify.js';
import { startPipeline } from './start.js';

/**
 * Le pipeline de bout en bout, sur un vrai PostgreSQL et le jeu de sites
 * local. Les fournisseurs sont simules, et la file est remplacee par une
 * liste videe dans l'ordre : ce qui est teste ici, c'est l'enchainement des
 * etapes et ce qu'elles ecrivent, pas BullMQ.
 */

let sites: TestSites;
let fetcher: Fetcher;
let userId: string;

const file: { step: CompanyStep; job: CompanyJob }[] = [];
let recherchesWeb = 0;
let recherchesLegales = 0;

const IDENTITES: Record<string, LegalIdentity> = {
  'Acme Industrie': {
    siren: '552100554',
    legalName: 'ACME INDUSTRIE',
    city: 'VILLEURBANNE',
    industry: '25.62B',
    employeeRange: '20 a 49 salaries',
  },
};

const RESULTATS: Record<string, WebResult[]> = {
  'Acme Industrie': [
    { url: 'https://acme.test/', title: 'Acme Industrie, usinage de precision', description: '' },
    { url: 'https://www.linkedin.com/company/acme', title: 'Acme | LinkedIn', description: '' },
  ],
  'Garage Dupont': [{ url: 'https://www.garages-du-rhone.fr/', title: 'Garages', description: '' }],
};

function dependances(limites = { perUserMonthly: 80, globalMonthly: 1000 }) {
  const deps: IdentifyDeps & CrawlDeps = {
    crawler: createCrawlerClient({
      fetcher,
      gate: createMemoryGate(),
      userAgent: 'MailFindBot/0.1 (+https://mailfind.app/bot)',
      minIntervalMs: 10,
    }),
    entreprises: {
      bySiren: () => Promise.resolve(undefined),
      byName: (nom) => {
        recherchesLegales += 1;
        return Promise.resolve(IDENTITES[nom]);
      },
    },
    webSearch: {
      name: 'brave',
      search: (requete) => {
        recherchesWeb += 1;
        const nom = Object.keys(RESULTATS).find((cle) => requete.startsWith(cle));
        return Promise.resolve(nom === undefined ? [] : (RESULTATS[nom] ?? []));
      },
    },
    webSearchLimits: limites,
    enqueue: (step, job) => {
      file.push({ step, job });
      return Promise.resolve();
    },
  };
  return deps;
}

async function vider(deps: IdentifyDeps & CrawlDeps): Promise<void> {
  for (let suivante = file.shift(); suivante !== undefined; suivante = file.shift()) {
    if (suivante.step === 'identify') await identifyCompany(deps, suivante.job);
    else await crawlStep(deps, suivante.job);
  }
}

const HEADERS = ['Entreprise', 'Domaine', 'Ville'];
const MAPPING: KnownField[] = ['company_name', 'domain', 'city'];

async function importer(
  lignes: string[][],
  reglages: Record<string, unknown> = {},
  proprietaire = userId,
): Promise<string> {
  const preparees: PreparedRow[] = lignes.map((ligne, index) => {
    const verdict = validateRow(HEADERS, MAPPING, ligne);
    const raw: Record<string, string> = {};
    HEADERS.forEach((header, colonne) => {
      const valeur = ligne[colonne];
      if (valeur !== undefined && valeur !== '') raw[header] = valeur;
    });
    return verdict.accepted
      ? { line: index + 2, raw, status: 'accepted', error: undefined }
      : { line: index + 2, raw, status: 'rejected', error: verdict.reason };
  });
  const cree = await createImport({
    userId: proprietaire,
    filename: 'salon.csv',
    settings: {
      depth: 'standard',
      emailTypes: ['recruitment', 'hr', 'generic'],
      providers: ['brave', 'hunter'],
      tags: [],
      ...reglages,
      columns: { headers: HEADERS, mapping: MAPPING },
    },
    rows: preparees,
  });
  return cree.id;
}

async function lancer(importId: string, deps = dependances()): Promise<void> {
  await planImport(importId, userId);
  await startPipeline(importId, userId, deps.enqueue);
  await vider(deps);
}

async function statut(importId: string): Promise<string | undefined> {
  const result = await query<{ status: string }>(
    'select status::text as status from imports where id = $1',
    [importId],
  );
  return result.rows[0]?.status;
}

interface Fiche {
  name: string;
  domain: string | null;
  domain_status: string;
  siren: string | null;
  crawl_status: string;
  crawl_notes: string[];
}

async function fiche(nom: string): Promise<Fiche | undefined> {
  const result = await query<Fiche>(
    `select name, domain, domain_status::text as domain_status, siren,
            crawl_status::text as crawl_status, crawl_notes::text[] as crawl_notes
       from companies where user_id = $1 and name = $2`,
    [userId, nom],
  );
  return result.rows[0];
}

async function adressesDe(nom: string): Promise<string[]> {
  const result = await query<{ ligne: string }>(
    `select e.normalized_address || ' ' || s.extraction_method || ' ' || s.url as ligne
       from emails e
       join companies c on c.id = e.company_id
       join email_sources s on s.email_id = e.id
      where c.user_id = $1 and c.name = $2
      order by 1`,
    [userId, nom],
  );
  return result.rows.map((row) => row.ligne);
}

beforeAll(async () => {
  sites = await startTestSites(['boulangerie.test', 'spa.test', 'acme.test', 'ferme.test']);
  fetcher = createFetcher({ testRouting: sites });
});

beforeEach(async () => {
  await resetData();
  await query('truncate provider_calls, provider_cache');
  file.length = 0;
  recherchesWeb = 0;
  recherchesLegales = 0;
  userId = await createUser();
});

afterAll(async () => {
  await fetcher.close();
  await sites.close();
  await closePool();
});

describe('pipeline d un import', () => {
  it('identifie, explore et enregistre chaque adresse avec sa page, puis termine l import', async () => {
    const importId = await importer([
      ['Boulangerie Martin', 'boulangerie.test', 'Lyon'],
      ['Spa Zen', 'spa.test', 'Lyon'],
      ['Acme Industrie', '', 'Villeurbanne'],
    ]);

    await lancer(importId);

    expect(await statut(importId)).toBe('completed');
    expect(await adressesDe('Boulangerie Martin')).toEqual([
      'boulangerie.martin.lyon@gmail.com text https://boulangerie.test/mentions-legales',
      'contact@boulangerie.test mailto https://boulangerie.test/contact',
      'info@boulangerie.test json_ld https://boulangerie.test/a-propos',
      'recrutement@boulangerie.test written_form https://boulangerie.test/recrutement',
      'rh@boulangerie.test text https://boulangerie.test/contact',
    ]);

    const boulangerie = await fiche('Boulangerie Martin');
    expect(boulangerie).toMatchObject({ crawl_status: 'done', domain_status: 'provided' });
    expect(boulangerie?.crawl_notes).toEqual(
      expect.arrayContaining(['robots_disallowed', 'masked_address', 'contact_form']),
    );
    expect((await fiche('Spa Zen'))?.crawl_notes).toContain('dynamic_content');
  });

  it('retrouve le SIREN et le site d une entreprise connue par son seul nom (F-304, F-305)', async () => {
    const importId = await importer([['Acme Industrie', '', 'Villeurbanne']]);
    await lancer(importId);

    expect(await fiche('Acme Industrie')).toMatchObject({
      siren: '552100554',
      domain: 'acme.test',
      domain_status: 'confirmed',
      crawl_status: 'done',
    });
    const appels = await query<{ status: string; n: number }>(
      `select status::text as status, count(*)::int as n from provider_calls group by status`,
    );
    expect(appels.rows).toEqual([{ status: 'confirmed', n: 1 }]);
  });

  it('ne rappelle pas le fournisseur quand l etape est rejouee (A5)', async () => {
    const importId = await importer([['Acme Industrie', '', 'Villeurbanne']]);
    const deps = dependances();
    await lancer(importId, deps);
    const avant = recherchesWeb;

    const entreprise = await query<{ id: string }>(`select id from companies where user_id = $1`, [
      userId,
    ]);
    // La fiche perd son domaine, et l'etape est rejouee comme apres une coupure.
    await query(`update companies set domain = null, domain_status = 'unknown'`);
    await identifyCompany(deps, {
      importId,
      companyId: entreprise.rows[0]?.id ?? '',
      userId,
    });

    expect(recherchesWeb).toBe(avant);
    expect((await fiche('Acme Industrie'))?.domain).toBe('acme.test');
  });

  it('laisse l utilisateur trancher un domaine incertain, sans explorer (F-305)', async () => {
    const importId = await importer([['Garage Dupont', '', 'Lyon']]);
    await lancer(importId);

    expect(await fiche('Garage Dupont')).toMatchObject({
      domain: 'garages-du-rhone.fr',
      domain_status: 'to_confirm',
      crawl_status: 'skipped',
    });
    expect(sites.requests.some((r) => r.host.includes('garages'))).toBe(false);
    expect(await statut(importId)).toBe('completed');
  });

  it('ne cherche pas le site quand l utilisateur a refuse le fournisseur', async () => {
    const importId = await importer([['Acme Industrie', '', 'Villeurbanne']], { providers: [] });
    await lancer(importId);

    expect(recherchesWeb).toBe(0);
    expect(await fiche('Acme Industrie')).toMatchObject({
      domain: null,
      crawl_status: 'skipped',
      crawl_notes: ['no_website'],
    });
  });

  it('s arrete au plafond de recherches du compte, et le dit', async () => {
    const importId = await importer([['Acme Industrie', '', 'Villeurbanne']]);
    await lancer(importId, dependances({ perUserMonthly: 0, globalMonthly: 1000 }));

    expect(recherchesWeb).toBe(0);
    const erreur = await query<{ crawl_error: string | null }>(
      'select crawl_error from companies where user_id = $1',
      [userId],
    );
    expect(erreur.rows[0]?.crawl_error).toMatch(/Plafond mensuel/);
    expect(await statut(importId)).toBe('completed');
  });

  it('ne visite pas un site qui interdit tout, et termine quand meme (A6)', async () => {
    const importId = await importer([['Ferme', 'ferme.test', '']]);
    await lancer(importId);

    expect(sites.requests.filter((r) => r.host === 'ferme.test').map((r) => r.path)).toEqual([
      '/robots.txt',
    ]);
    expect((await fiche('Ferme'))?.crawl_notes).toEqual(['robots_disallowed']);
    expect(await statut(importId)).toBe('completed');
  });

  it('n ajoute rien quand la collecte est rejouee', async () => {
    const importId = await importer([['Boulangerie Martin', 'boulangerie.test', 'Lyon']]);
    const deps = dependances();
    await lancer(importId, deps);
    const avant = await adressesDe('Boulangerie Martin');

    await query(`update companies set crawled_at = null`);
    const entreprise = await query<{ id: string }>('select id from companies');
    await crawlStep(deps, { importId, companyId: entreprise.rows[0]?.id ?? '', userId });

    expect(await adressesDe('Boulangerie Martin')).toEqual(avant);
  });

  it('n explore pas a nouveau une entreprise vue il y a moins d une semaine', async () => {
    const premier = await importer([['Boulangerie Martin', 'boulangerie.test', 'Lyon']]);
    await lancer(premier);
    sites.requests.length = 0;

    const second = await importer([['Boulangerie Martin', 'boulangerie.test', 'Lyon']]);
    await lancer(second);

    expect(sites.requests.filter((r) => r.host === 'boulangerie.test')).toEqual([]);
    expect(await statut(second)).toBe('completed');
  });

  it('arrete les etapes restantes d un import annule, sans rien defaire (F-205)', async () => {
    const importId = await importer([
      ['Boulangerie Martin', 'boulangerie.test', 'Lyon'],
      ['Spa Zen', 'spa.test', 'Lyon'],
    ]);
    const deps = dependances();
    await planImport(importId, userId);
    await startPipeline(importId, userId, deps.enqueue);

    // La premiere identification passe, puis l'utilisateur annule.
    const premiere = file.shift();
    if (premiere === undefined) throw new Error('etape attendue');
    await identifyCompany(deps, premiere.job);
    await cancelImport(userId, importId);
    await vider(deps);

    expect(await statut(importId)).toBe('cancelled');
    const etapes = await query<{ step: string; status: string }>(
      `select step::text as step, status::text as status from pipeline_jobs
        where import_id = $1 order by step, status`,
      [importId],
    );
    expect(etapes.rows).toEqual([
      { step: 'crawl', status: 'skipped' },
      { step: 'identify', status: 'done' },
      { step: 'identify', status: 'skipped' },
    ]);
    expect(sites.requests.some((r) => r.host === 'boulangerie.test' && r.path === '/contact')).toBe(
      false,
    );
  });

  it('ne cherche l identite legale qu une fois par entreprise sans SIREN', async () => {
    const importId = await importer([['Acme Industrie', '', 'Villeurbanne']]);
    await lancer(importId);
    expect(recherchesLegales).toBe(1);
  });
});
