import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import session from 'express-session';
import { createApp } from '../app.js';
import { CURRENT_TERMS_VERSION } from '../auth/routes.js';
import { createCrawlerClient } from '../crawler/client.js';
import { createMemoryGate } from '../crawler/politeness.js';
import { closePool, query } from '../db/pool.js';
import { planImport } from '../imports/plan.js';
import { getLogger } from '../observability/logger.js';
import { crawlStep } from '../pipeline/crawl.js';
import { enrichStep } from '../pipeline/enrich.js';
import { identifyCompany } from '../pipeline/identify.js';
import { startPipeline, type Enqueue } from '../pipeline/start.js';
import { verifyStep } from '../pipeline/verify.js';
import { createFetcher } from '../net/safe-fetch.js';
import { createVerifyDeps } from '../pipeline/verify-deps.js';
import { startTestSites, type TestSites } from '../test/sites/server.js';

/**
 * L'application telle qu'un navigateur la rencontre, pour le parcours de bout
 * en bout (Phase 9).
 *
 * Trois choses sont remplacees, et chacune parce qu'elle sort de la machine.
 * Tout le reste est le vrai code : la base, les migrations, le pipeline, les
 * quotas, les exports, les ecrans.
 *
 * - **Connexion** : `/e2e/connexion` ouvre une session pour un compte de
 *   test. Passer par Google demanderait un vrai compte et un vrai
 *   consentement, qu'un test ne peut pas tenir.
 * - **Internet** : le jeu de sites local de `src/test/sites`, atteint par
 *   l'aiguillage de test du client. Aucune requete ne quitte la machine.
 * - **Files** : les etapes s'executent dans la requete. Un processus de
 *   traitement a part demanderait un Redis et rendrait le test dependant d'un
 *   ordonnancement.
 *
 * Ce fichier refuse de demarrer ailleurs que sur une base de test : il ecrit
 * et efface, et se tromper de base serait irreparable.
 */

const HOSTS = ['acme.test', 'boulangerie.test', 'ferme.test'] as const;

export interface E2eServer {
  readonly app: Express;
  readonly sites: TestSites;
  readonly userId: string;
  close(): Promise<void>;
}

function verifierBaseDeTest(): void {
  const url = process.env.DATABASE_URL ?? '';
  const nom = url === '' ? '' : new URL(url).pathname.replace(/^\//, '');
  if (!nom.includes('test')) {
    throw new Error(
      `Le serveur de bout en bout ecrit et efface : il ne demarre que sur une base dont le nom contient « test ». Vu : « ${nom} ».`,
    );
  }
}

/** Le compte du parcours, conditions deja acceptees. */
async function compteDeTest(): Promise<string> {
  const identifiant = `e2e-${randomUUID()}`;
  const cree = await query<{ id: string }>(
    `insert into users (google_id, email, name, terms_version, terms_accepted_at)
     values ($1, $2, 'Parcours de test', $3, now())
     returning id`,
    [identifiant, `${identifiant}@exemple.test`, CURRENT_TERMS_VERSION],
  );
  const ligne = cree.rows[0];
  if (ligne === undefined) throw new Error("Le compte de test n'a pas ete cree.");
  return ligne.id;
}

export async function createE2eServer(): Promise<E2eServer> {
  verifierBaseDeTest();

  const sites = await startTestSites(HOSTS);
  const fetcher = createFetcher({ testRouting: { port: sites.port, hosts: [...HOSTS] } });
  const crawler = createCrawlerClient({
    fetcher,
    gate: createMemoryGate(),
    userAgent: 'MailFindBot/0.1 (+https://mailfind.app/bot)',
    // La politesse a ses propres tests : une seconde entre deux pages ferait
    // durer le parcours pour rien.
    minIntervalMs: 0,
  });

  const userId = await compteDeTest();

  /**
   * Les entreprises du parcours arrivent avec leur domaine, comme un fichier
   * bien rempli : ni annuaire legal, ni recherche web, ni enrichissement.
   * Ce que le parcours prouve, c'est la chaine, pas les fournisseurs, qui ont
   * leurs propres tests.
   */
  const sansFournisseur = {
    ...createVerifyDeps(undefined),
    crawler,
    entreprises: {
      bySiren: () => Promise.resolve(undefined),
      byName: () => Promise.resolve(undefined),
    },
    webSearchLimits: { perUserMonthly: 0, globalMonthly: 0 },
    providers: [],
    providerLimits: {},
    // Les sites du parcours sont en `.test` : aucun DNS public ne les
    // connait, et attendre son silence ferait durer le parcours pour rien.
    // Ils recoivent du courrier, comme un vrai domaine d'entreprise.
    mailDns: {
      mx: () => Promise.resolve([{ exchange: 'mx.exemple.test', priority: 10 }]),
      hasAddress: () => Promise.resolve(true),
    },
  };

  const enqueue: Enqueue = async (step, job) => {
    const deps = { ...sansFournisseur, enqueue } as never;
    if (step === 'identify') await identifyCompany(deps, job);
    else if (step === 'crawl') await crawlStep({ crawler, enqueue }, job);
    else if (step === 'enrich') await enrichStep(deps, job);
    else await verifyStep(deps, job);
  };

  const app = createApp({
    logger: getLogger(),
    session: session({
      name: 'mailfind.sid',
      secret: 'parcours-de-bout-en-bout-secret-assez-long',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, secure: false, sameSite: 'lax' },
    }),
    enqueue,
    // La planification se fait dans la requete, a la place de BullMQ : a la
    // fin du POST, l'import est traite.
    enqueuePlan: async ({ importId, userId: compte }) => {
      const issue = await planImport(importId, compte);
      if (issue.status === 'completed') await startPipeline(importId, compte, enqueue);
    },
    register: (application) => {
      // La porte du parcours : elle ouvre une session, puis renvoie a
      // l'accueil, comme le ferait le retour de Google.
      application.get('/e2e/connexion', (req, res, next) => {
        req.session.regenerate((erreur) => {
          if (erreur) {
            next(erreur);
            return;
          }
          req.session.userId = userId;
          req.session.save((echec) => {
            if (echec) next(echec);
            else res.redirect('/');
          });
        });
      });
    },
  });

  return {
    app,
    sites,
    userId,
    close: async () => {
      await sites.close();
      await closePool();
    },
  };
}
