import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCrawlerClient } from '../crawler/client.js';
import { createMemoryGate } from '../crawler/politeness.js';
import { closePool, query } from '../db/pool.js';
import type { KnownField } from '../imports/fields.js';
import { cancelImport, planImport } from '../imports/plan.js';
import { createImport, importProgress, type PreparedRow } from '../imports/repository.js';
import { validateRow } from '../imports/validate.js';
import { createFetcher, type Fetcher } from '../net/safe-fetch.js';
import type { LegalIdentity } from '../providers/recherche-entreprises.js';
import type { WebResult } from '../providers/web-search.js';
import type { CompanyJob, CompanyStep } from '../queue/queues.js';
import { createUser, resetData } from '../test/integration/db.js';
import { startTestSites, type TestSites } from '../test/sites/server.js';
import { crawlStep, saveCrawlReport, type CrawlDeps } from './crawl.js';
import { enrichStep, type EnrichDeps } from './enrich.js';
import { randomBytes } from 'node:crypto';
import { createCipher } from '../security/crypto.js';
import { ProviderError, type DomainSearchResult } from '../providers/enrichment.js';
import { identifyCompany, type IdentifyDeps } from './identify.js';
import { addSuppressions, removeSuppression } from '../suppressions/repository.js';
import { verifyStep, type VerifyDeps } from './verify.js';
import type { MailboxResult } from '../providers/enrichment.js';
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
let appelsHunter = 0;
let verificationsHunter = 0;

/** Ce que la verification de boite simulee rend, par adresse ; « valid » sinon. */
const BOITES: Record<string, MailboxResult | 'panne'> = {
  'drh@spa.test': { status: 'invalid', subStatus: 'undeliverable' },
  'hr@spa.test': { status: 'accept_all', subStatus: 'risky' },
  'rh@spa.test': 'panne',
};

/** Ce que Hunter simule rend, par domaine. */
const HUNTER: Record<string, DomainSearchResult | 'quota'> = {
  'spa.test': {
    domain: 'spa.test',
    pattern: '{first}.{last}',
    emails: [
      {
        address: 'jobs@spa.test',
        kind: 'generic',
        confidence: 91,
        sourceUrls: ['https://spa.test/emplois'],
      },
      { address: 'marie.durand@spa.test', kind: 'personal', confidence: 80, sourceUrls: [] },
      { address: 'hello@autre-site.fr', kind: 'generic', sourceUrls: [] },
    ],
  },
  'ferme.test': 'quota',
};

const CHIFFREUR = createCipher(randomBytes(32).toString('hex'));

/** Domaines sans serveur de messagerie, pour la resolution simulee. */
const SANS_MX = new Set(['ferme.test']);

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

type Deps = IdentifyDeps & CrawlDeps & EnrichDeps & VerifyDeps;

function dependances(
  limites = { perUserMonthly: 80, globalMonthly: 1000 },
  enrichissement: Partial<EnrichDeps & VerifyDeps> = {},
) {
  const mx = (domaine: string) =>
    SANS_MX.has(domaine)
      ? Promise.reject(Object.assign(new Error('ENODATA'), { code: 'ENODATA' }))
      : Promise.resolve([{ exchange: `mx.${domaine}`, priority: 10 }]);
  const deps: Deps = {
    providers: [
      {
        name: 'hunter',
        domainSearch: (domaine) => {
          appelsHunter += 1;
          const reponse = HUNTER[domaine];
          if (reponse === 'quota')
            return Promise.reject(
              new ProviderError('Hunter : quota ou debit depasse', 'quota', 429),
            );
          return Promise.resolve(reponse ?? { domain: domaine, emails: [] });
        },
      },
    ],
    // Une seule cle, comme en production : sinon le cache d'un premier
    // passage serait illisible au second, qui paierait a nouveau.
    cipher: CHIFFREUR,
    providerLimits: { hunter: { perUserMonthly: 3, globalMonthly: 30 } },
    mx,
    mailDns: { mx, hasAddress: () => Promise.resolve(false) },
    disposableDomains: () => Promise.resolve(new Set(['yopmail.com'])),
    verifier: {
      name: 'hunter',
      verify: (adresse) => {
        verificationsHunter += 1;
        const reponse = BOITES[adresse];
        if (reponse === 'panne') {
          return Promise.reject(new ProviderError('Hunter : indisponible', 'unavailable', 503));
        }
        return Promise.resolve(reponse ?? { status: 'valid', subStatus: 'deliverable' });
      },
    },
    // D-14 : quatre verifications par compte, un demi-credit chacune.
    verificationLimits: { perUserMonthly: 2, globalMonthly: 20 },
    ...enrichissement,
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

async function vider(deps: Deps): Promise<void> {
  for (let suivante = file.shift(); suivante !== undefined; suivante = file.shift()) {
    if (suivante.step === 'identify') await identifyCompany(deps, suivante.job);
    else if (suivante.step === 'crawl') await crawlStep(deps, suivante.job);
    else if (suivante.step === 'enrich') await enrichStep(deps, suivante.job);
    else await verifyStep(deps, suivante.job);
  }
}

const HEADERS = ['Entreprise', 'Domaine', 'Ville', 'Contact'];
const MAPPING: KnownField[] = ['company_name', 'domain', 'city', 'contact_name'];

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
  appelsHunter = 0;
  verificationsHunter = 0;
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
      `select status::text as status, count(*)::int as n from provider_calls
        where provider = 'brave' group by status`,
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

  it('rend une progression fidele, etape par etape, et les entreprises a regarder', async () => {
    const importId = await importer([
      ['Boulangerie Martin', 'boulangerie.test', 'Lyon'],
      ['Spa Zen', 'spa.test', 'Lyon'],
      ['Garage Dupont', '', 'Lyon'],
    ]);
    await lancer(importId);

    const progression = await importProgress(userId, importId);
    // Cinq adresses sur le site de la boulangerie ; pour le spa, rien sur le
    // site, deux chez Hunter et cinq deduites.
    expect(progression).toMatchObject({
      companies: 3,
      identify: { pending: 0, running: 0, done: 3, failed: 0, skipped: 0 },
      crawl: { pending: 0, running: 0, done: 2, failed: 0, skipped: 1 },
      enrich: { pending: 0, running: 0, done: 2, failed: 0, skipped: 0 },
      emails: 12,
      emailsByOrigin: { found: 5, provider: 2, deduced: 5 },
    });
    // La boulangerie a une page interdite et une adresse masquee, mais elle a
    // donne cinq adresses : rien a y regarder.
    expect(progression.issues.map((issue) => [issue.name, issue.domainStatus])).toEqual([
      ['Garage Dupont', 'to_confirm'],
      ['Spa Zen', 'provided'],
    ]);

    // Un autre compte ne voit rien de cet import (S-04).
    const autre = await createUser();
    expect(await importProgress(autre, importId)).toMatchObject({
      companies: 0,
      emails: 0,
      issues: [],
    });
  });

  it('compte pour le recrutement une adresse generique revue sur la page carrieres (6.8)', async () => {
    const importId = await importer([['Boulangerie Martin', 'boulangerie.test', 'Lyon']]);
    await lancer(importId);
    const entreprise = await query<{ id: string }>(
      'select id from companies where user_id = $1 and name = $2',
      [userId, 'Boulangerie Martin'],
    );
    const companyId = entreprise.rows[0]?.id ?? '';
    const vue = (pageUrl: string) => ({
      pages: [],
      notes: [],
      addresses: [
        {
          address: 'bonjour@boulangerie.test',
          normalized: 'bonjour@boulangerie.test',
          method: 'mailto' as const,
          excerpt: 'bonjour@boulangerie.test',
          pageUrl,
        },
      ],
    });
    const type = async () =>
      (
        await query<{ type: string }>(
          `select type::text as type from emails where normalized_address = 'bonjour@boulangerie.test'`,
        )
      ).rows[0]?.type;

    await saveCrawlReport(companyId, userId, vue('https://boulangerie.test/contact'));
    expect(await type()).toBe('generic');
    await saveCrawlReport(companyId, userId, vue('https://boulangerie.test/nous-rejoindre'));
    expect(await type()).toBe('recruitment');
    // Revue ensuite sur une page ordinaire, elle garde ce que la page carrieres a dit.
    await saveCrawlReport(companyId, userId, vue('https://boulangerie.test/contact'));
    expect(await type()).toBe('recruitment');
  });

  it('n appelle pas Hunter quand le site a donne tous les types recherches (F-603)', async () => {
    const importId = await importer([['Boulangerie Martin', 'boulangerie.test', 'Lyon']]);
    await lancer(importId);

    expect(appelsHunter).toBe(0);
    const origines = await query<{ origin: string }>(
      'select distinct origin::text as origin from emails',
    );
    expect(origines.rows).toEqual([{ origin: 'found' }]);
  });

  it('comble les types manquants par Hunter puis par deduction, chacun avec sa source', async () => {
    const importId = await importer([['Spa Zen', 'spa.test', 'Lyon']]);
    await lancer(importId);

    expect(appelsHunter).toBe(1);
    const adresses = await query<{ ligne: string }>(
      `select e.normalized_address || ' ' || e.origin || ' ' || e.type || ' ' || e.status || ' ' ||
              s.kind || ' ' || coalesce(s.provider, '-') as ligne
         from emails e join email_sources s on s.email_id = e.id
        order by e.normalized_address`,
    );
    // Hunter a donne le recrutement ; manquent les RH et le generique, un
    // prefixe de chacun a tour de role, cinq au plus.
    expect(adresses.rows.map((r) => r.ligne)).toEqual([
      'contact@spa.test deduced generic unverified deduction -',
      'drh@spa.test deduced hr unverified deduction -',
      'hello@spa.test deduced generic unverified deduction -',
      'hr@spa.test deduced hr unverified deduction -',
      'jobs@spa.test provider recruitment unverified provider hunter',
      'marie.durand@spa.test provider personal unverified provider hunter',
      'rh@spa.test deduced hr unverified deduction -',
    ]);
    // L'adresse d'un autre domaine rendue par le fournisseur n'est pas gardee.
    expect(adresses.rows.some((r) => r.ligne.includes('autre-site'))).toBe(false);
  });

  it('deduit une adresse nominative du nom donne et du format observe, et de rien d autre (F-504)', async () => {
    const importId = await importer([['Spa Zen', 'spa.test', 'Lyon', 'Paul Martin']]);
    await lancer(importId);

    const nominatives = await query<{ normalized_address: string; excerpt: string }>(
      `select e.normalized_address, s.context_excerpt as excerpt
         from emails e join email_sources s on s.email_id = e.id
        where e.origin = 'deduced' and e.type = 'personal'`,
    );
    expect(nominatives.rows).toEqual([
      {
        normalized_address: 'paul.martin@spa.test',
        excerpt: expect.stringMatching(/format \{first\}\.\{last\} observe par hunter/),
      },
    ]);
    // Cinq adresses deduites au plus, nominative comprise (F-505).
    const deduites = await query<{ n: number }>(
      `select count(*)::int as n from emails where origin = 'deduced'`,
    );
    expect(deduites.rows[0]?.n).toBeLessThanOrEqual(5);
  });

  it('ne deduit aucune adresse nominative sans format observe', async () => {
    const importId = await importer([
      ['Boulangerie Martin', 'boulangerie.test', 'Lyon', 'Paul Martin'],
    ]);
    await lancer(importId);
    const nominatives = await query<{ n: number }>(
      `select count(*)::int as n from emails where origin = 'deduced' and type = 'personal'`,
    );
    expect(nominatives.rows[0]?.n).toBe(0);
  });

  it('n appelle pas Hunter quand l utilisateur l a refuse, et deduit quand meme', async () => {
    const importId = await importer([['Spa Zen', 'spa.test', 'Lyon']], { providers: ['brave'] });
    await lancer(importId);

    expect(appelsHunter).toBe(0);
    const deduites = await query<{ n: number }>(
      `select count(*)::int as n from emails where origin = 'deduced'`,
    );
    expect(deduites.rows[0]?.n).toBe(5);
  });

  it('continue apres une erreur de fournisseur, et ne deduit rien sans serveur de messagerie (F-606, F-502)', async () => {
    const importId = await importer([['Ferme du Coin', 'ferme.test', '']]);
    await lancer(importId);

    expect(await statut(importId)).toBe('completed');
    const etape = await query<{ status: string; error: string }>(
      `select status::text as status, error from pipeline_jobs where step = 'enrich'`,
    );
    expect(etape.rows[0]?.status).toBe('done');
    expect(etape.rows[0]?.error).toMatch(/quota/);
    expect(etape.rows[0]?.error).toMatch(/sans serveur de messagerie/);
    const adresses = await query<{ n: number }>('select count(*)::int as n from emails');
    expect(adresses.rows[0]?.n).toBe(0);
  });

  it('n appelle aucun fournisseur sans cle de chiffrement (F-604)', async () => {
    const importId = await importer([['Spa Zen', 'spa.test', 'Lyon']]);
    const { cipher: _cle, ...sansCle } = dependances();
    await lancer(importId, sansCle);
    expect(appelsHunter).toBe(0);
  });

  it('ne rappelle pas Hunter et n ajoute rien quand l enrichissement est rejoue', async () => {
    const importId = await importer([['Spa Zen', 'spa.test', 'Lyon']]);
    const deps = dependances();
    await lancer(importId, deps);
    const avant = await query<{ n: number }>('select count(*)::int as n from email_sources');

    const entreprise = await query<{ id: string }>('select id from companies');
    await enrichStep(deps, { importId, companyId: entreprise.rows[0]?.id ?? '', userId });

    expect(appelsHunter).toBe(1);
    const apres = await query<{ n: number }>('select count(*)::int as n from email_sources');
    expect(apres.rows[0]?.n).toBe(avant.rows[0]?.n);
  });

  it('une seconde entreprise sur le meme domaine, dans un autre import, ne coute aucun credit (DoD Phase 4)', async () => {
    const premier = await importer([['Spa Zen', 'spa.test', 'Lyon']]);
    await lancer(premier);
    const autre = await createUser();
    const second = await importer([['Spa Zen', 'spa.test', 'Lyon']], {}, autre);
    const deps = dependances();
    await planImport(second, autre);
    await startPipeline(second, autre, deps.enqueue);
    await vider(deps);

    expect(appelsHunter).toBe(1);
    const credits = await query<{ n: number }>(
      `select count(*)::int as n from provider_calls where provider = 'hunter' and status = 'confirmed'`,
    );
    expect(credits.rows[0]?.n).toBe(1);
  });
});

describe('verification et score (Phase 5)', () => {
  async function adresses() {
    const result = await query<{
      adresse: string;
      status: string;
      score: number | null;
      excluded: boolean;
      somme: number | null;
    }>(
      `select e.normalized_address as adresse, e.status::text as status, e.score, e.excluded,
              (select sum((l ->> 'points')::int)::int
                 from jsonb_array_elements(e.score_breakdown -> 'criteria') l) as somme
         from emails e
        order by e.normalized_address`,
    );
    return result.rows;
  }

  it('applique les controles locaux a chaque adresse et calcule son score, sans rien payer', async () => {
    const importId = await importer([['Boulangerie Martin', 'boulangerie.test', 'Lyon']]);
    await lancer(importId);

    expect(await statut(importId)).toBe('completed');
    expect(verificationsHunter).toBe(0);
    const lignes = await adresses();
    expect(lignes.map((l) => `${l.adresse} ${l.status}`)).toEqual([
      'boulangerie.martin.lyon@gmail.com risky',
      'contact@boulangerie.test unverified',
      'info@boulangerie.test unverified',
      'recrutement@boulangerie.test unverified',
      'rh@boulangerie.test unverified',
    ]);
    // Le detail affiche est le calcul : la somme des lignes est le score.
    for (const ligne of lignes) expect(ligne.somme, ligne.adresse).toBe(ligne.score);
    // Site officiel, page contact et type recherche : 40 + 10 + 5.
    expect(lignes.find((l) => l.adresse === 'rh@boulangerie.test')?.score).toBe(55);

    const historique = await query<{ n: number; max: number }>(
      'select count(*)::int as n, max(level)::int as max from verifications',
    );
    expect(historique.rows[0]).toEqual({ n: 5, max: 7 });
    const progression = await importProgress(userId, importId);
    expect(progression.verify).toMatchObject({ done: 1 });
    expect(progression.emailsByStatus).toEqual({ risky: 1, unverified: 4 });
  });

  it('verifie les boites quand l import le demande, et ecarte une candidate invalide (F-702, F-503)', async () => {
    const importId = await importer([['Spa Zen', 'spa.test', 'Lyon']], { mailboxCheck: 'all' });
    await lancer(
      importId,
      dependances(undefined, {
        verificationLimits: { perUserMonthly: 10, globalMonthly: 20 },
      }),
    );

    expect(verificationsHunter).toBe(7);
    const lignes = await adresses();
    expect(lignes.map((l) => `${l.adresse} ${l.status} ${String(l.excluded)}`)).toEqual([
      'contact@spa.test valid false',
      'drh@spa.test invalid true',
      'hello@spa.test valid false',
      'hr@spa.test accept_all false',
      'jobs@spa.test valid false',
      'marie.durand@spa.test valid false',
      // La panne du fournisseur ne conclut rien : le statut local reste.
      'rh@spa.test unverified false',
    ]);
    for (const ligne of lignes) expect(ligne.somme, ligne.adresse).toBe(ligne.score);
    expect(lignes.find((l) => l.adresse === 'drh@spa.test')?.score).toBe(0);

    const niveau8 = await query<{ adresse: string; sub_status: string; provider: string }>(
      `select e.normalized_address as adresse, v.sub_status, v.provider
         from verifications v join emails e on e.id = v.email_id
        where v.level = 8 and e.normalized_address = 'hr@spa.test'`,
    );
    expect(niveau8.rows).toEqual([
      { adresse: 'hr@spa.test', sub_status: 'risky', provider: 'hunter' },
    ]);

    // La candidate refusee n'est ni comptee ni montree.
    const progression = await importProgress(userId, importId);
    expect(progression.emails).toBe(6);
    expect(progression.emailsByStatus.invalid).toBeUndefined();
    const etape = await query<{ error: string }>(
      `select error from pipeline_jobs where step = 'verify'`,
    );
    expect(etape.rows[0]?.error).toMatch(/1 adresse\(s\) : erreur du fournisseur/);
  });

  it('ne verifie a « trouvees seulement » que les adresses non deduites, dans le plafond du compte', async () => {
    const importId = await importer([['Spa Zen', 'spa.test', 'Lyon']], { mailboxCheck: 'found' });
    await lancer(importId);
    // jobs@ et marie.durand@ viennent du fournisseur ; les candidates attendent.
    expect(verificationsHunter).toBe(2);
    const credits = await query<{ total: string }>(
      `select sum(credits)::text as total from provider_calls where operation = 'verification'`,
    );
    expect(credits.rows[0]?.total).toBe('1.00');
  });

  it('s arrete au plafond du compte, et le dit', async () => {
    const importId = await importer([['Spa Zen', 'spa.test', 'Lyon']], { mailboxCheck: 'all' });
    await lancer(importId);
    // Deux credits, un demi par verification : quatre boites payees, pas une
    // de plus. L'appel en panne n'a rien coute, il ne compte pas.
    expect(verificationsHunter).toBe(5);
    const payees = await query<{ n: number; total: string }>(
      `select count(*)::int as n, sum(credits)::text as total
         from provider_calls where operation = 'verification' and status = 'confirmed'`,
    );
    expect(payees.rows[0]).toEqual({ n: 4, total: '2.00' });
    const etape = await query<{ error: string }>(
      `select error from pipeline_jobs where step = 'verify'`,
    );
    expect(etape.rows[0]?.error).toMatch(/2 adresse\(s\) : plafond mensuel du compte atteint/);
  });

  it('ne paie jamais deux fois une verification, meme rejouee apres 30 jours', async () => {
    const importId = await importer([['Spa Zen', 'spa.test', 'Lyon']], { mailboxCheck: 'found' });
    const deps = dependances();
    await lancer(importId, deps);
    expect(verificationsHunter).toBe(2);
    const entreprise = await query<{ id: string }>('select id from companies');
    const job = { importId, companyId: entreprise.rows[0]?.id ?? '', userId };

    // Rejouee tout de suite : a jour, rien n'est refait.
    const avant = await query<{ n: number }>('select count(*)::int as n from verifications');
    await verifyStep(deps, job);
    const apres = await query<{ n: number }>('select count(*)::int as n from verifications');
    expect(apres.rows[0]?.n).toBe(avant.rows[0]?.n);

    // Dans 31 jours, elle est refaite (F-704), mais la reponse deja payee
    // pour cet import est relue du cache.
    const plusTard = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    await verifyStep({ ...deps, now: () => plusTard }, job);
    expect(verificationsHunter).toBe(2);
    const refaites = await query<{ n: number }>(
      'select count(*)::int as n from verifications where level = 8',
    );
    expect(refaites.rows[0]?.n).toBe(4);
  });

  it('dit pourquoi une boite n est pas verifiee sans fournisseur configure', async () => {
    const importId = await importer([['Boulangerie Martin', 'boulangerie.test', 'Lyon']], {
      mailboxCheck: 'found',
    });
    const { verifier: _v, ...sansFournisseur } = dependances();
    await lancer(importId, sansFournisseur);
    const etape = await query<{ error: string }>(
      `select error from pipeline_jobs where step = 'verify'`,
    );
    expect(etape.rows[0]?.error).toMatch(/fournisseur non configure/);
  });

  it('ne laisse aucune adresse invalide, jetable ou supprimee au-dessus de 0 (DoD Phase 5)', async () => {
    const importId = await importer(
      [
        ['Boulangerie Martin', 'boulangerie.test', 'Lyon'],
        ['Spa Zen', 'spa.test', 'Lyon'],
      ],
      { mailboxCheck: 'all' },
    );
    const deps = dependances(undefined, {
      verificationLimits: { perUserMonthly: 20, globalMonthly: 20 },
    });
    await lancer(importId, deps);
    await addSuppressions(userId, ['contact@boulangerie.test'], undefined);

    // La verification suivante garde la suppression, et son score a 0.
    const boulangerie = await query<{ id: string }>(
      `select id from companies where name = 'Boulangerie Martin'`,
    );
    await verifyStep(deps, { importId, companyId: boulangerie.rows[0]?.id ?? '', userId });

    const fautives = await query<{ adresse: string }>(
      `select normalized_address as adresse from emails
        where status in ('invalid', 'disposable', 'suppressed') and score > 0`,
    );
    expect(fautives.rows).toEqual([]);
    const supprimee = (await adresses()).find((l) => l.adresse === 'contact@boulangerie.test');
    expect(supprimee).toMatchObject({ status: 'suppressed', score: 0, excluded: true });
    expect(supprimee?.somme).toBe(0);

    // Retiree de la liste par l'utilisateur, elle revient a la verification suivante.
    await removeSuppression(userId, 'contact@boulangerie.test');
    await verifyStep(deps, { importId, companyId: boulangerie.rows[0]?.id ?? '', userId });
    const revenue = (await adresses()).find((l) => l.adresse === 'contact@boulangerie.test');
    expect(revenue).toMatchObject({ status: 'valid', excluded: false });
    expect(revenue?.score).toBeGreaterThan(0);
  });
});
