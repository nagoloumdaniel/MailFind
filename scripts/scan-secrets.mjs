// Cherche un secret dans tout l'historique git, pas seulement dans l'arbre
// de travail (Phase 10, S-11).
//
// Un secret retire par un commit reste dans l'historique, et l'historique est
// public le jour ou le depot le devient. Ce script lit chaque version de
// chaque fichier texte deja versionne, et signale ce qui ressemble a un
// secret.
//
//   npm run scan:secrets
//
// Sortie non nulle des qu'une trouvaille n'est pas un exemple connu.

import { spawnSync } from 'node:child_process';
import process from 'node:process';

const ecrire = (texte) => process.stdout.write(`${texte}\n`);

function git(args, options = {}) {
  const issue = spawnSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
  if (issue.status !== 0) throw new Error(`git ${args[0]} : ${issue.stderr}`);
  return issue.stdout;
}

/**
 * Ce qui ressemble a un secret. Chaque motif porte son nom, pour que la
 * trouvaille se lise sans deviner.
 */
const MOTIFS = [
  ['cle d API MailFind', /\bmf_[A-Za-z0-9_-]{43}\b/],
  ['jeton Campaign Mailer', /\bcm_[A-Za-z0-9_-]{43}\b/],
  ['secret de webhook', /\bwhsec_[A-Za-z0-9_-]{43}\b/],
  ['jeton Google', /\bya29\.[\w-]{20,}/],
  ['jeton de rafraichissement Google', /\b1\/\/[\w-]{30,}/],
  ['cle AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['identifiant client Google', /\b\d{10,}-[a-z0-9]{32}\.apps\.googleusercontent\.com\b/],
  ['secret client Google', /\bGOCSPX-[\w-]{20,}\b/],
  ['DSN Sentry', /https:\/\/[0-9a-f]{32}@[\w.]*ingest[\w.]*sentry\.io/],
  ['chaine PostgreSQL avec mot de passe', /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s:@/]+@/],
  ['chaine Redis avec mot de passe', /rediss?:\/\/[^\s:@/]+:[^\s:@/]+@/],
  [
    'cle de chiffrement en hexadecimal',
    /\b(?:ENCRYPTION_KEY|SESSION_SECRET)\s*[=:]\s*["']?[0-9a-f]{64}\b/,
  ],
  // Cloudflare R2 ne prefixe pas ses cles : seul le nom de la variable dit
  // ce que la valeur est.
  ['cle R2', /\bR2_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY)\s*[=:]\s*["']?[0-9a-f]{32,}\b/],
  ['cle de fournisseur', /\b(?:HUNTER_API_KEY|BRAVE_SEARCH_API_KEY)\s*[=:]\s*["']?[\w-]{16,}\b/],
];

/**
 * Ce qui ressemble a un secret sans en etre un : les valeurs des modeles, des
 * tests et de la documentation. Chacune est ici parce qu'elle a ete regardee.
 */
const CONNUS = [
  // Les modeles n'ont que des valeurs vides ou des exemples explicites.
  /\.env\.example$/,
  // Les tests fabriquent des jetons de la bonne forme, faits de lettres
  // repetees : aucun n'a jamais servi.
  /^(backend\/src\/.*\.test\.ts|backend\/src\/e2e\/.*|e2e\/.*)$/,
  // Les documents citent la forme d'un secret pour l'expliquer.
  /^docs\//,
  /^scripts\/scan-secrets\.mjs$/,
];

const estAttendu = (fichier, ligne) =>
  CONNUS.some((motif) => motif.test(fichier)) ||
  // Un jeton fait d'un seul caractere repete est un exemple, pas un secret.
  /([A-Za-z0-9])\1{20,}/.test(ligne) ||
  /localhost|127\.0\.0\.1|exemple|example|test:test|user:pass|CHANGEME|\.\.\./i.test(ligne);

// Chaque version de chaque fichier texte : `git log -p` suit l'historique
// entier, renommages compris.
const diff = git([
  'log',
  '--all',
  '-p',
  '--no-color',
  '--unified=0',
  '--diff-filter=AM',
  '--format=%n@@commit %H',
]);

let fichier = '';
let commit = '';
const trouvailles = [];
const vues = new Set();

for (const ligne of diff.split('\n')) {
  if (ligne.startsWith('@@commit ')) {
    commit = ligne.slice(9, 16);
    continue;
  }
  if (ligne.startsWith('+++ b/')) {
    fichier = ligne.slice(6);
    continue;
  }
  if (!ligne.startsWith('+') || ligne.startsWith('+++')) continue;

  const contenu = ligne.slice(1);
  for (const [nom, motif] of MOTIFS) {
    if (!motif.test(contenu)) continue;
    if (estAttendu(fichier, contenu)) continue;
    const cle = `${fichier}:${nom}`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    trouvailles.push({ commit, fichier, nom, extrait: contenu.trim().slice(0, 120) });
  }
}

ecrire(`${String(git(['rev-list', '--all', '--count']).trim())} commits balayes.`);

if (trouvailles.length === 0) {
  ecrire('Aucun secret dans l historique.');
  process.exit(0);
}

for (const { commit: ou, fichier: quoi, nom, extrait } of trouvailles) {
  ecrire(`\n${nom}`);
  ecrire(`  ${quoi}, commit ${ou}`);
  ecrire(`  ${extrait}`);
}
ecrire(
  `\n${String(trouvailles.length)} trouvaille(s). Un secret publie se revoque et se remplace, il ne se retire pas de l historique.`,
);
process.exit(1);
