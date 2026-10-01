import { defineRailway, github, preserve, project, service } from 'railway/iac';

/**
 * L'infrastructure Railway de MailFind, en code (Phase 10).
 *
 * Deux services sur le meme depot : l'API, qui repond aux requetes, et le
 * processus de traitement, qui vide les files. Ils partagent la base, Redis et
 * les memes secrets ; sans le second, un import reste `pending`.
 *
 * Les valeurs qui ne sont pas des secrets sont ecrites ici, pour qu'une revue
 * voie la configuration reelle. Les secrets sont poses hors de ce fichier, par
 * `railway variable set --stdin`, et `preserve()` dit a Railway de garder la
 * valeur en place : aucun secret n'entre dans le depot.
 *
 * Applique par `railway config apply`. Sous Windows, le SDK cherche le binaire
 * du CLI dans la variable `_` : la poser evite un refus au demarrage.
 *
 *   $env:_ = "$env:APPDATA\node_modules\@railway\cli\bin\railway.exe"
 */

/** Les secrets, poses hors du depot, que les deux services relisent. */
const secrets = {
  DATABASE_URL: preserve(),
  DIRECT_DATABASE_URL: preserve(),
  REDIS_URL: preserve(),
  SESSION_SECRET: preserve(),
  ENCRYPTION_KEY: preserve(),
  GOOGLE_CLIENT_ID: preserve(),
  GOOGLE_CLIENT_SECRET: preserve(),
  R2_ACCESS_KEY_ID: preserve(),
  R2_SECRET_ACCESS_KEY: preserve(),
  R2_ENDPOINT: preserve(),
  BRAVE_SEARCH_API_KEY: preserve(),
  HUNTER_API_KEY: preserve(),
  CAMPAIGN_MAILER_SSO_SECRET: preserve(),
  SENTRY_DSN: preserve(),
  // Les origines publiques, posees une fois les deux hebergeurs connus.
  APP_URL: preserve(),
  API_URL: preserve(),
  GOOGLE_CALLBACK_URL: preserve(),
  CAMPAIGN_MAILER_API_URL: preserve(),
};

/** Ce que les deux services lisent de la meme facon, et qui n'est pas secret. */
const commun = {
  ...secrets,
  NODE_ENV: 'production',
  LOG_LEVEL: 'info',
  REDIS_SESSION_PREFIX: 'mailfind:sess:',
  BULLMQ_PREFIX: 'mailfind:bull',
  R2_BUCKET: 'mailfind-exports',

  // L'agent de collecte s'annonce et donne une adresse de contact (F-404).
  CRAWLER_USER_AGENT: 'MailFindBot/0.1 (+https://mailfind.app/bot)',
  CRAWLER_REQUESTS_PER_SECOND_PER_DOMAIN: '1',
  CRAWLER_REQUEST_TIMEOUT_MS: '10000',
  CRAWLER_MAX_RESPONSE_BYTES: '3000000',
  CRAWLER_MAX_REDIRECTS: '2',

  RECHERCHE_ENTREPRISES_BASE_URL: 'https://recherche-entreprises.api.gouv.fr',
  BRAVE_SEARCH_BASE_URL: 'https://api.search.brave.com',
  HUNTER_BASE_URL: 'https://api.hunter.io',

  // Plafonds par compte et par mois (D-13, D-14).
  QUOTA_WEB_SEARCHES_PER_USER_PER_MONTH: '80',
  QUOTA_PROVIDER_SEARCHES_PER_USER_PER_MONTH: '3',
  QUOTA_MAILBOX_VERIFICATIONS_PER_USER_PER_MONTH: '4',
  HUNTER_MONTHLY_SEARCH_CREDITS: '30',
  HUNTER_MONTHLY_VERIFICATION_CREDITS: '20',
  BRAVE_MONTHLY_FREE_QUERIES: '1000',
  API_RATE_LIMIT_PER_MINUTE: '60',
};

// Les deux espaces de travail partagent un seul verrou : l'installation se
// fait a la racine, pas dans backend/.
const BUILD = 'npm ci && npm run build --workspace backend';
const SOURCE = github('nagoloumdaniel/MailFind', { branch: 'main' });

export default defineRailway(() => {
  const api = service('api', {
    source: SOURCE,
    build: { buildCommand: BUILD },
    start: 'node backend/dist/index.js',
    // Railway cesse d'envoyer du trafic a une instance qui ne repond pas ici.
    healthcheck: '/health',
    env: commun,
  });

  const worker = service('worker', {
    source: SOURCE,
    build: { buildCommand: BUILD },
    start: 'node backend/dist/worker.js',
    // Aucun port, donc aucun domaine : il ne recoit pas de requetes. Il
    // redemarre toujours, car une file qui n'est plus lue arrete le produit.
    env: commun,
  });

  return project('mailfind', { resources: [api, worker] });
});
