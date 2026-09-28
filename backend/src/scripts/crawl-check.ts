import { readFile } from 'node:fs/promises';
import { createCrawlerClient } from '../crawler/client.js';
import { crawlCompany, type CrawlReport } from '../crawler/engine.js';
import { appearsIn } from '../crawler/verify.js';
import type { CrawlDepth } from '../crawler/pages.js';
import { createMemoryGate } from '../crawler/politeness.js';
import { getEnvironment } from '../config/env.js';
import { normalizeDomain } from '../companies/normalize.js';
import { createFetcher, type Fetcher } from '../net/safe-fetch.js';

/**
 * Preuve de la Definition of Done de la Phase 3, sur de vraies entreprises :
 * « chaque adresse relevee pointe vers la page ou elle figure ».
 *
 *   npm run crawl:check -- domaines.txt [--profondeur standard]
 *
 * Un domaine par ligne. Chaque site est explore par le vrai moteur, avec les
 * vraies regles (robots.txt, une requete par seconde, garde des adresses),
 * puis chaque adresse relevee est recontrolee : la page citee comme source est
 * relue, et l'adresse doit y figurer. Rien n'est ecrit en base.
 *
 * Le script est lent a dessein : une requete par seconde et par site, et les
 * sites l'un apres l'autre.
 */

function sortie(ligne = ''): void {
  process.stdout.write(`${ligne}\n`);
}

async function recontroler(fetcher: Fetcher, rapport: CrawlReport) {
  const pages = new Map<string, string>();
  const resultats: { adresse: string; page: string; ok: boolean }[] = [];
  for (const trouvee of rapport.addresses) {
    let corps = pages.get(trouvee.pageUrl);
    if (corps === undefined) {
      // Une seconde lecture de la meme page : on attend la seconde de rigueur.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        corps = (await fetcher.fetchPage(trouvee.pageUrl)).body;
      } catch {
        corps = '';
      }
      pages.set(trouvee.pageUrl, corps);
    }
    resultats.push({
      adresse: trouvee.address,
      page: trouvee.pageUrl,
      ok: appearsIn(corps, trouvee.address),
    });
  }
  return resultats;
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Les variables par defaut suffisent a la collecte.
  }
  const [fichier, ...options] = process.argv.slice(2);
  if (fichier === undefined) {
    sortie('Usage : npm run crawl:check -- domaines.txt [--profondeur quick|standard|deep]');
    process.exitCode = 2;
    return;
  }
  const indice = options.indexOf('--profondeur');
  const profondeur = (indice === -1 ? 'standard' : options[indice + 1]) as CrawlDepth;

  const domaines = (await readFile(fichier, 'utf8'))
    .split(/\r?\n/)
    .map((ligne) => normalizeDomain(ligne.trim()))
    .filter((domaine): domaine is string => domaine !== undefined);

  const environment = getEnvironment();
  const fetcher = createFetcher();
  const client = createCrawlerClient({
    fetcher,
    gate: createMemoryGate(),
    userAgent: environment.CRAWLER_USER_AGENT,
    minIntervalMs: Math.ceil(1000 / environment.CRAWLER_REQUESTS_PER_SECOND_PER_DOMAIN),
  });

  let adresses = 0;
  let confirmees = 0;
  let avecAdresse = 0;
  const notes = new Map<string, number>();

  for (const [rang, domaine] of domaines.entries()) {
    sortie(`[${String(rang + 1)}/${String(domaines.length)}] ${domaine}`);
    const rapport = await crawlCompany(client, { domain: domaine, depth: profondeur });
    for (const note of rapport.notes) notes.set(note, (notes.get(note) ?? 0) + 1);
    const lues = rapport.pages.filter((page) => page.outcome === 'read').length;
    sortie(`  ${String(lues)} pages lues, notes : ${rapport.notes.join(', ') || 'aucune'}`);

    const controle = await recontroler(fetcher, rapport);
    if (controle.length > 0) avecAdresse += 1;
    for (const { adresse, page, ok } of controle) {
      adresses += 1;
      if (ok) confirmees += 1;
      sortie(`  ${ok ? 'OK    ' : 'ABSENTE'} ${adresse}  <-  ${page}`);
    }
  }

  await fetcher.close();

  sortie();
  sortie(
    `Entreprises : ${String(domaines.length)}, dont ${String(avecAdresse)} avec au moins une adresse`,
  );
  sortie(
    `Adresses relevees : ${String(adresses)}, retrouvees sur leur page : ${String(confirmees)}`,
  );
  sortie(
    `Notes : ${[...notes.entries()].map(([note, n]) => `${note} ${String(n)}`).join(', ') || 'aucune'}`,
  );
  // Aucune adresse relevee ne prouve rien : ni que le critere tient, ni qu'il
  // echoue. Le dire tenu serait conclure sur du vide.
  if (adresses === 0) {
    sortie(
      'Critere NON demontre : aucune adresse relevee. Verifiez que les sites sont joignables.',
    );
    process.exitCode = 1;
  } else if (adresses === confirmees) {
    sortie('Critere tenu : chaque adresse pointe vers la page ou elle figure.');
  } else {
    sortie('Critere NON tenu : certaines adresses sont absentes de la page citee.');
    process.exitCode = 1;
  }
}

await main();
