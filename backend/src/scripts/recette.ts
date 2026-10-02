import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCrawlerClient } from '../crawler/client.js';
import { createMemoryGate } from '../crawler/politeness.js';
import { getEnvironment } from '../config/env.js';
import { closePool, query } from '../db/pool.js';
import { planImport } from '../imports/plan.js';
import { MAILBOX_CHECKS, importSettingsSchema } from '../imports/settings.js';
import { submitImport } from '../imports/submit.js';
import { createFetcher } from '../net/safe-fetch.js';
import { crawlStep } from '../pipeline/crawl.js';
import { enrichStep } from '../pipeline/enrich.js';
import { identifyCompany } from '../pipeline/identify.js';
import { startPipeline, type Enqueue } from '../pipeline/start.js';
import { verifyStep } from '../pipeline/verify.js';
import { createConfiguredCipher, createVerifyDeps } from '../pipeline/verify-deps.js';
import { createRechercheEntreprisesClient } from '../providers/recherche-entreprises.js';
import { createBraveSearch } from '../providers/web-search.js';
import type { CompanyJob, CompanyStep } from '../queue/queues.js';

/**
 * La recette de la Phase 10 : A1 et A2, sur de vraies entreprises.
 *
 *   npm run recette -- docs/recette/phase-10-cent-entreprises.csv
 *
 * Un import complet, par le vrai code et sur de vrais sites : identification,
 * collecte, enrichissement, verification. Rien n'est simule que les files,
 * remplacees par un ordonnanceur a concurrence fixe, parce qu'un processus de
 * traitement a part ne changerait rien a ce qui est mesure.
 *
 * - **A1** : traite de bout en bout sans intervention, en moins de 15 minutes.
 * - **A2** : 70 % des entreprises dont le site repond portent au moins une
 *   adresse `valid` ou `risky`.
 * - **A4**, verifie au passage : aucune adresse sans source.
 *
 * A lancer sur la branche de developpement, jamais sur la production : il
 * ecrit cent entreprises et leurs adresses.
 */

/** Ce que fait le processus de traitement : plusieurs entreprises de front. */
const CONCURRENCE = 8;
const LIMITE_MINUTES = 15;
const CIBLE_COUVERTURE = 0.7;

const sortie = (ligne = '') => process.stdout.write(`${ligne}\n`);

interface Ligne {
  readonly entreprise: string;
  readonly domaine: string;
  readonly site: string;
}

function lireCsv(contenu: string): Ligne[] {
  const [, ...lignes] = contenu.trim().split(/\r?\n/);
  return lignes
    .filter((ligne) => ligne.trim() !== '' && !ligne.startsWith('#'))
    .map((ligne) => {
      const [entreprise = '', domaine = '', site = ''] = ligne.split(',');
      return { entreprise: entreprise.trim(), domaine: domaine.trim(), site: site.trim() };
    });
}

/** Un ordonnanceur a concurrence fixe : la file, sans Redis. */
function ordonnanceur(concurrence: number) {
  const attente: (() => Promise<void>)[] = [];
  let enCours = 0;
  let resoudreVide: (() => void) | undefined;

  const avancer = () => {
    while (enCours < concurrence && attente.length > 0) {
      const tache = attente.shift();
      if (tache === undefined) break;
      enCours += 1;
      void tache().finally(() => {
        enCours -= 1;
        avancer();
        if (enCours === 0 && attente.length === 0) resoudreVide?.();
      });
    }
  };

  return {
    ajouter(tache: () => Promise<void>) {
      attente.push(tache);
      avancer();
    },
    vide: () =>
      new Promise<void>((resoudre) => {
        if (enCours === 0 && attente.length === 0) {
          resoudre();
          return;
        }
        resoudreVide = resoudre;
      }),
  };
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Les valeurs par defaut suffisent a lire le fichier ; la base, non.
  }

  const arguments_ = process.argv.slice(2);
  const chemin = arguments_.find((a) => !a.startsWith('--'));
  if (chemin === undefined) {
    sortie(
      'Usage : npm run recette -- docs/recette/phase-10-cent-entreprises.csv [--boites=never|found|all]',
    );
    process.exit(2);
  }
  // A2 demande des adresses `valid` : elles exigent un fournisseur, et le
  // fournisseur se paie. Par defaut la recette ne depense rien, et le dit.
  const demande = arguments_.find((a) => a.startsWith('--boites='))?.slice('--boites='.length);
  const boites = demande ?? 'never';
  if (!(MAILBOX_CHECKS as readonly string[]).includes(boites)) {
    sortie(`--boites doit valoir ${MAILBOX_CHECKS.join(', ')}.`);
    process.exit(2);
  }
  sortie(`Verification de boite : ${boites}.`);

  const base = new URL(getEnvironment().DATABASE_URL).pathname.replace(/^\//, '');
  const branche = new URL(getEnvironment().DATABASE_URL).hostname;
  sortie(`Base : ${base} sur ${branche}`);

  const lignes = lireCsv(await readFile(resolve(process.env.INIT_CWD ?? '.', chemin), 'utf8'));
  sortie(`${String(lignes.length)} entreprises a traiter.`);

  const compte = await query<{ id: string }>(
    `insert into users (google_id, email, name, terms_version, terms_accepted_at)
     values ($1, $2, 'Recette', '2026-10-02', now())
     on conflict (google_id) do update set updated_at = now()
     returning id`,
    ['recette-phase-10', 'recette@exemple.test'],
  );
  const userId = compte.rows[0]?.id ?? '';

  const environment = getEnvironment();
  const gate = createMemoryGate();
  const fetcher = createFetcher();
  const crawler = createCrawlerClient({
    fetcher,
    gate,
    userAgent: environment.CRAWLER_USER_AGENT,
    minIntervalMs: Math.ceil(1000 / environment.CRAWLER_REQUESTS_PER_SECOND_PER_DOMAIN),
  });
  const cipher = createConfiguredCipher();
  const verifyDeps = createVerifyDeps(cipher);
  const cle = environment.BRAVE_SEARCH_API_KEY;
  if (cle === '') {
    sortie('BRAVE_SEARCH_API_KEY vide : les entreprises sans domaine resteront sans site.');
  }
  const entreprises = createRechercheEntreprisesClient({
    baseUrl: environment.RECHERCHE_ENTREPRISES_BASE_URL,
    userAgent: environment.CRAWLER_USER_AGENT,
    throttle: <T>(tache: () => Promise<T>) =>
      gate.run('recherche-entreprises.api.gouv.fr', 1000, tache),
  });

  const file = ordonnanceur(CONCURRENCE);
  const enqueue: Enqueue = (step: CompanyStep, job: CompanyJob) => {
    file.ajouter(async () => {
      if (step === 'identify') {
        await identifyCompany(
          {
            entreprises,
            ...(cle === ''
              ? {}
              : {
                  webSearch: createBraveSearch({
                    apiKey: cle,
                    baseUrl: environment.BRAVE_SEARCH_BASE_URL,
                  }),
                }),
            webSearchLimits: {
              perUserMonthly: environment.QUOTA_WEB_SEARCHES_PER_USER_PER_MONTH,
              globalMonthly: environment.BRAVE_MONTHLY_FREE_QUERIES,
            },
            enqueue,
          },
          job,
        );
      } else if (step === 'crawl') {
        await crawlStep({ crawler, enqueue }, job);
      } else if (step === 'enrich') {
        // Aucun fournisseur payant : la recette mesure ce que le robot trouve seul.
        await enrichStep(
          {
            providers: [],
            ...(cipher === undefined ? {} : { cipher }),
            providerLimits: {},
            mx: (domaine: string) => verifyDeps.mailDns.mx(domaine),
            enqueue,
          },
          job,
        );
      } else {
        await verifyStep(verifyDeps, job);
      }
    });
    return Promise.resolve();
  };

  const depart = Date.now();
  const resume = await submitImport(
    {
      userId,
      filename: 'recette-phase-10.csv',
      headers: ['entreprise', 'domaine', 'site'],
      mapping: ['company_name', 'domain', 'website_url'],
      rows: lignes.map((ligne) => [ligne.entreprise, ligne.domaine, ligne.site]),
      settings: importSettingsSchema.parse({ depth: 'standard', mailboxCheck: boites }),
    },
    { enqueue: false },
  );
  await planImport(resume.id, userId);
  await startPipeline(resume.id, userId, enqueue);
  await file.vide();
  const minutes = (Date.now() - depart) / 60_000;

  // --- Ce que la base dit, une fois le travail fini
  const mesure = await query<{
    entreprises: string;
    explores: string;
    ignores: string;
    echecs: string;
    sans_domaine: string;
    couvertes: string;
    locales: string;
    vues_sur_site: string;
    adresses: string;
    sans_source: string;
    boites_payees: string;
  }>(
    `with mes_entreprises as (
       select c.id, c.crawl_status::text as statut, c.domain
         from companies c
         join import_rows r on r.company_id = c.id
        where r.import_id = $1
        group by c.id, c.crawl_status, c.domain
     )
     select count(*)::text as entreprises,
            count(*) filter (where statut = 'done')::text as explores,
            count(*) filter (where statut = 'skipped')::text as ignores,
            count(*) filter (where statut = 'failed')::text as echecs,
            count(*) filter (where domain is null)::text as sans_domaine,
            count(*) filter (where statut = 'done' and exists (
              select 1 from emails e
               where e.company_id = mes_entreprises.id and e.status in ('valid', 'risky')
            ))::text as couvertes,
            count(*) filter (where statut = 'done' and exists (
              select 1 from emails e
               where e.company_id = mes_entreprises.id
                 and e.status in ('valid', 'risky', 'unverified')
            ))::text as locales,
            count(*) filter (where statut = 'done' and exists (
              select 1 from emails e
                 join email_sources s on s.email_id = e.id
               where e.company_id = mes_entreprises.id and s.kind = 'website'
                 and e.status in ('valid', 'risky', 'unverified')
            ))::text as vues_sur_site,
            (select count(*)::text from emails e
               join mes_entreprises m on m.id = e.company_id) as adresses,
            (select count(*)::text from emails e
               join mes_entreprises m on m.id = e.company_id
              where not exists (select 1 from email_sources s where s.email_id = e.id)
            ) as sans_source,
            (select count(*)::text from verifications v
               join emails e on e.id = v.email_id
               join mes_entreprises m on m.id = e.company_id
              where v.provider is not null) as boites_payees
       from mes_entreprises`,
    [resume.id],
  );
  const m = mesure.rows[0];
  const avecSite = Number(m?.explores ?? 0);
  const part = (n: string | undefined) => (avecSite === 0 ? 0 : Number(n ?? 0) / avecSite);
  const couverture = part(m?.couvertes);
  const boitesPayees = Number(m?.boites_payees ?? 0);

  sortie();
  sortie('--- Resultat');
  sortie(`Entreprises traitees                         ${String(m?.entreprises ?? 0)}`);
  sortie(`Sites explores (crawl_status = done)         ${String(avecSite)}`);
  sortie(
    `Sites ignores / en echec                     ${String(m?.ignores ?? 0)} / ${String(m?.echecs ?? 0)}`,
  );
  sortie(`Entreprises restees sans domaine             ${String(m?.sans_domaine ?? 0)}`);
  sortie(`Adresses relevees                            ${String(m?.adresses ?? 0)}`);
  sortie(`Verifications de boite payees                ${String(boitesPayees)}`);
  sortie();
  sortie('Couverture, du signal le plus fort au plus faible :');
  sortie(
    `  adresse valide ou risquee (A2)             ${String(m?.couvertes ?? 0)} / ${String(avecSite)}  ${(couverture * 100).toFixed(0)} %`,
  );
  sortie(
    `  adresse vue sur le site de l'entreprise    ${String(m?.vues_sur_site ?? 0)} / ${String(avecSite)}  ${(part(m?.vues_sur_site) * 100).toFixed(0)} %`,
  );
  sortie(
    `  adresse passant tous les controles locaux  ${String(m?.locales ?? 0)} / ${String(avecSite)}  ${(part(m?.locales) * 100).toFixed(0)} %`,
  );
  sortie();

  const a1 = minutes < LIMITE_MINUTES;
  const a4 = Number(m?.sans_source ?? 0) === 0;
  sortie(
    `A1  duree ${minutes.toFixed(1)} min sur ${String(LIMITE_MINUTES)}        ${a1 ? 'tenu' : 'NON TENU'}`,
  );
  // Sans verification de boite, `valid` est hors d'atteinte par conception : on
  // ne sonde pas une boite depuis nos serveurs. A2 n'est alors pas en echec, il
  // n'est pas mesurable, et le dire est plus utile que de le declarer manque.
  if (boitesPayees === 0) {
    sortie(
      `A2  couverture ${(couverture * 100).toFixed(0)} % sur ${String(CIBLE_COUVERTURE * 100)} %   NON MESURABLE : aucune verification de boite`,
    );
  } else {
    sortie(
      `A2  couverture ${(couverture * 100).toFixed(0)} % sur ${String(CIBLE_COUVERTURE * 100)} %   ${couverture >= CIBLE_COUVERTURE ? 'tenu' : 'NON TENU'}`,
    );
  }
  sortie(
    `A4  adresses sans source : ${String(m?.sans_source ?? 0)}         ${a4 ? 'tenu' : 'NON TENU'}`,
  );

  const a2 = boitesPayees > 0 && couverture >= CIBLE_COUVERTURE;
  if (!a1 || !a2 || !a4) process.exitCode = 1;
}

try {
  await main();
} finally {
  await closePool();
}
