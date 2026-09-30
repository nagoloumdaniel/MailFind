/**
 * Configuration minimale des tests, posee avant l'import de tout module qui
 * lit l'environnement.
 *
 * Les valeurs sont fausses a dessein : un test unitaire ne doit joindre ni
 * base ni Redis. Ce qui a besoin d'un vrai service le declare et se branche
 * lui-meme. Les variables deja presentes ne sont pas ecrasees, pour qu'un test
 * puisse imposer la sienne.
 */
const DEFAULTS: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  APP_URL: 'http://localhost:5173',
  API_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test?sslmode=verify-full',
  DIRECT_DATABASE_URL: 'postgresql://test:test@localhost:5432/test?sslmode=verify-full',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'secret-de-test-suffisamment-long-pour-le-schema',
  GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'GOCSPX-test',
  GOOGLE_CALLBACK_URL: 'http://localhost:3000/api/auth/google/callback',
  // Jamais joint : les tests injectent un client vers un faux Campaign Mailer.
  CAMPAIGN_MAILER_API_URL: 'http://campaign-mailer.test',
  CAMPAIGN_MAILER_SSO_SECRET: 'secret-partage-de-test-assez-long-pour-le-schema',
};

for (const [name, value] of Object.entries(DEFAULTS)) {
  process.env[name] ??= value;
}
