// La barriere complete, sur cette machine.
//
// GitHub Actions est restreint sur ce compte : le workflow de `.github/`
// existe et reste juste, mais personne ne l'execute. Ce script tient le role,
// avec les memes etapes et les memes services : un PostgreSQL 18 et un Redis
// jetables, montes ici, effaces a la fin quoi qu'il arrive.
//
//   npm run ci              tout, services compris
//   npm run ci -- --no-db   sans les services, donc sans les tests d'integration
//   npm run ci -- --keep    garde les conteneurs, pour enquÃªter apres un echec
//
// Sortie non nulle a la premiere etape en echec : c'est ce que lit le hook de
// pre-push.

import { spawnSync } from 'node:child_process';
import process from 'node:process';

const options = new Set(process.argv.slice(2));
const sansBase = options.has('--no-db');
const garder = options.has('--keep');

const PG = { nom: 'mailfind-ci-pg', image: 'postgres:18', port: 55433 };
const REDIS = { nom: 'mailfind-ci-redis', image: 'redis:8', port: 56379 };

const ecrire = (texte) => process.stdout.write(`${texte}\n`);
const duree = (ms) => `${(ms / 1000).toFixed(1)} s`;

/** Lance une commande, rend son code. La sortie va a l'ecran, en direct. */
function lancer(commande, env = {}) {
  return spawnSync(commande, {
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
}

/** Comme `lancer`, mais silencieuse : pour interroger Docker. */
function interroger(commande) {
  const issue = spawnSync(commande, { shell: true, encoding: 'utf8' });
  return { ok: issue.status === 0, sortie: (issue.stdout ?? '').trim() };
}

function dockerRepond() {
  return interroger('docker info').ok;
}

function demarrerService({ nom, image, port }, variables, sonde) {
  interroger(`docker rm -f ${nom}`);
  const env = variables.map((paire) => `-e ${paire}`).join(' ');
  const lance = interroger(
    `docker run -d --name ${nom} ${env} -p ${port}:${sonde.portInterne} ${image}`,
  );
  if (!lance.ok) throw new Error(`${nom} n'a pas demarre.`);

  for (let essai = 0; essai < 60; essai += 1) {
    if (interroger(`docker exec ${nom} ${sonde.commande}`).ok) return;
    spawnSync(process.platform === 'win32' ? 'timeout /t 2 /nobreak' : 'sleep 2', {
      shell: true,
      stdio: 'ignore',
    });
  }
  throw new Error(`${nom} n'a pas repondu dans le temps imparti.`);
}

function arreterServices() {
  if (garder) {
    ecrire(`\nConteneurs gardes : ${PG.nom}, ${REDIS.nom}. Les effacer : docker rm -f <nom>`);
    return;
  }
  for (const { nom } of [PG, REDIS]) interroger(`docker rm -f ${nom}`);
}

const etapes = [
  // Le verrou d'abord : une desynchronisation fait echouer les deux
  // hebergeurs, qui installent tous les deux par `npm ci`.
  { nom: 'verrou de dependances', commande: 'npm ci --dry-run --no-audit --no-fund' },
  { nom: 'format', commande: 'npm run format:check' },
  { nom: 'lint', commande: 'npm run lint' },
  { nom: 'types', commande: 'npm run typecheck' },
  // Les tests unitaires d'abord, sans base : ils disent en dix secondes si
  // quelque chose est casse, avant les deux minutes de la couverture.
  { nom: 'tests unitaires', commande: 'npm test' },
  { nom: 'construction', commande: 'npm run build' },
  { nom: 'vulnerabilites', commande: 'npm audit --audit-level=high' },
];

const ENV_SERVICES = {
  TEST_DATABASE_URL: `postgresql://test:test@localhost:${String(PG.port)}/mailfind_test?sslmode=disable`,
  TEST_REDIS_URL: `redis://localhost:${String(REDIS.port)}`,
};

const avecServices = [
  {
    // La couverture fait tourner les deux suites, pas seulement l'integration,
    // et fait echouer la CI sous les seuils.
    nom: 'couverture',
    commande: 'npm run test:coverage',
    env: ENV_SERVICES,
  },
  {
    // Le parcours refait le schema a neuf : il passe apres la couverture, pas
    // avant, sinon il effacerait la base sous ses pieds.
    nom: 'parcours de bout en bout',
    commande: 'npm run test:e2e',
    env: ENV_SERVICES,
  },
];

let docker = false;
if (!sansBase) {
  docker = dockerRepond();
  if (!docker) {
    ecrire('Docker ne repond pas : les tests d integration seront sautes.');
    ecrire('Demarrez Docker Desktop, ou lancez `npm run ci -- --no-db` pour l assumer.\n');
  }
}

const aFaire = docker ? [...etapes, ...avecServices] : etapes;
const resultats = [];
let echec;

try {
  if (docker) {
    ecrire('Demarrage des services jetables...');
    demarrerService(
      PG,
      ['POSTGRES_USER=test', 'POSTGRES_PASSWORD=test', 'POSTGRES_DB=mailfind_test'],
      {
        portInterne: 5432,
        commande: 'pg_isready -U test -d mailfind_test',
      },
    );
    demarrerService(REDIS, [], { portInterne: 6379, commande: 'redis-cli ping' });
    ecrire('Services prets.\n');
  }

  for (const etape of aFaire) {
    ecrire(`\n=== ${etape.nom}`);
    const depart = Date.now();
    const issue = lancer(etape.commande, etape.env ?? {});
    const temps = Date.now() - depart;
    resultats.push({ nom: etape.nom, ok: issue.status === 0, temps });
    if (issue.status !== 0) {
      echec = etape.nom;
      break;
    }
  }
} catch (erreur) {
  echec = erreur instanceof Error ? erreur.message : 'erreur inattendue';
} finally {
  arreterServices();
}

ecrire('\n--- Bilan');
for (const { nom, ok, temps } of resultats) {
  ecrire(`${ok ? 'ok   ' : 'ECHEC'} ${nom.padEnd(24)} ${duree(temps)}`);
}
if (!docker && !sansBase) ecrire('saute integration et parcours        Docker absent');
if (sansBase) ecrire('saute integration et parcours        --no-db');

if (echec !== undefined) {
  ecrire(`\nArrete sur : ${echec}`);
  process.exit(1);
}
ecrire('\nTout passe.');
