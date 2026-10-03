import { closePool, query } from '../db/pool.js';

/**
 * Les indicateurs de la section 2.2 du cahier des charges, mesures plutot que
 * supposes.
 *
 *   MAILFIND_API_URL=https://... MAILFIND_API_KEY=mf_... npm run indicateurs
 *
 * Les trois indicateurs que la base sait repondre sont lus en base : couverture,
 * adresses sans source, cout fournisseur par entreprise. La latence est mesuree
 * contre l'API indiquee, parce que la seule latence qui compte est celle que
 * voit un appelant, reseau et plateforme comprises.
 *
 * Le taux de rebond est le seul qui n'est pas ici : il se lit dans Campaign
 * Mailer, apres des campagnes reelles. Il reste a relever pendant la beta.
 */

const TIRAGES = 40;
const CIBLE_COUVERTURE = 0.7;
const CIBLE_LATENCE_MS = 300;

const sortie = (ligne = '') => process.stdout.write(`${ligne}\n`);

const verdict = (tenu: boolean) => (tenu ? 'tenu' : 'NON TENU');

/** Un centile par rang : avec quarante tirages, le 95e est la 38e valeur triee. */
function centile(valeurs: readonly number[], part: number): number {
  const triees = [...valeurs].sort((a, b) => a - b);
  const rang = Math.ceil(triees.length * part) - 1;
  return triees[Math.min(Math.max(rang, 0), triees.length - 1)] ?? 0;
}

interface Releve {
  readonly temps: readonly number[];
  /** Vrai quand la requete a bien rendu la lecture demandee. */
  readonly complet: boolean;
}

async function mesurerLatence(base: string, cle: string): Promise<Map<string, Releve>> {
  const chemins = ['/v1/usage', '/v1/companies?limit=25', '/v1/emails?limit=25'];
  const releves = new Map<string, Releve>();

  for (const chemin of chemins) {
    const appel = () => fetch(`${base}${chemin}`, { headers: { authorization: `Bearer ${cle}` } });
    // Un premier appel non compte : il paie le reveil de la base et la connexion.
    const essai = await appel();
    const corps = await essai.text();
    // Un refus pour conditions non acceptees traverse quand meme tout le chemin
    // de lecture : la plateforme, l'API, la cle, le compte. La mesure vaut donc
    // encore quelque chose, a condition de dire ce qu'elle ne couvre pas.
    const conditions = essai.status === 403 && corps.includes('terms_not_accepted');
    if (!essai.ok && !conditions) {
      sortie(`${chemin} a repondu ${String(essai.status)} : latence non mesurable.`);
      continue;
    }

    const temps: number[] = [];
    for (let i = 0; i < TIRAGES; i += 1) {
      const depart = performance.now();
      const reponse = await appel();
      await reponse.arrayBuffer();
      if (reponse.status !== essai.status) break;
      temps.push(performance.now() - depart);
    }
    if (temps.length > 0) releves.set(chemin, { temps, complet: !conditions });
  }
  return releves;
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Les variables d'environnement du shell suffisent.
  }

  sortie('--- Indicateurs de la section 2.2');
  sortie();

  // --- Couverture, sources, cout : ce que la base sait
  const base = await query<{
    avec_site: string;
    couvertes: string;
    sans_source: string;
    entreprises: string;
    cout_cents: string;
  }>(
    `select (select count(*)::text from companies where crawl_status = 'done') as avec_site,
            (select count(*)::text from companies c
              where c.crawl_status = 'done'
                and exists (select 1 from emails e
                             where e.company_id = c.id and e.status in ('valid', 'risky'))
            ) as couvertes,
            (select count(*)::text from emails e
              where not exists (select 1 from email_sources s where s.email_id = e.id)
            ) as sans_source,
            (select count(*)::text from companies) as entreprises,
            (select coalesce(sum(cost_cents), 0)::text from provider_calls) as cout_cents`,
  );
  const b = base.rows[0];
  const avecSite = Number(b?.avec_site ?? 0);
  const couvertes = Number(b?.couvertes ?? 0);
  const couverture = avecSite === 0 ? 0 : couvertes / avecSite;
  const entreprises = Number(b?.entreprises ?? 0);
  const coutParEntreprise = entreprises === 0 ? 0 : Number(b?.cout_cents ?? 0) / entreprises;
  const sansSource = Number(b?.sans_source ?? 0);

  sortie(
    `Couverture                 ${(couverture * 100).toFixed(0)} % (${String(couvertes)} / ${String(avecSite)}), cible 70 %   ${verdict(couverture >= CIBLE_COUVERTURE)}`,
  );
  sortie(
    `Adresses sans source       ${String(sansSource)}, cible 0                          ${verdict(sansSource === 0)}`,
  );
  sortie(
    `Cout fournisseur moyen     ${coutParEntreprise.toFixed(2)} centime(s) par entreprise sur ${String(entreprises)}`,
  );

  // --- Latence : ce que voit un appelant
  const url = process.env.MAILFIND_API_URL;
  const cle = process.env.MAILFIND_API_KEY;
  sortie();
  if (url === undefined || cle === undefined) {
    sortie('Latence API : non mesuree, MAILFIND_API_URL ou MAILFIND_API_KEY manquante.');
  } else {
    const releves = await mesurerLatence(url.replace(/\/$/, ''), cle);
    let pireCentile = 0;
    let tousComplets = releves.size > 0;
    for (const [chemin, releve] of releves) {
      const p95 = centile(releve.temps, 0.95);
      const median = centile(releve.temps, 0.5);
      pireCentile = Math.max(pireCentile, p95);
      if (!releve.complet) tousComplets = false;
      sortie(
        `Latence ${chemin.padEnd(26)} p95 ${p95.toFixed(0)} ms, median ${median.toFixed(0)} ms${releve.complet ? '' : '  (arretee au controle des conditions)'}`,
      );
    }
    if (releves.size > 0) {
      sortie(
        `Latence API en lecture     p95 le plus haut ${pireCentile.toFixed(0)} ms, cible 300 ms   ${tousComplets ? verdict(pireCentile < CIBLE_LATENCE_MS) : 'INDICATIF'}`,
      );
      if (!tousComplets) {
        sortie(
          '  Le compte de la cle doit accepter les conditions en cours pour que la lecture elle-meme soit mesuree.',
        );
      }
    }
  }

  sortie();
  sortie('Taux de rebond : a relever dans Campaign Mailer apres les campagnes de la beta.');
  sortie(
    'Duree de traitement de 100 entreprises : mesuree par npm run recette, pas par ce script.',
  );
}

try {
  await main();
} finally {
  await closePool();
}
