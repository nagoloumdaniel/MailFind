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
};

for (const [name, value] of Object.entries(DEFAULTS)) {
  process.env[name] ??= value;
}
