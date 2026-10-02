import preparerBase from '../test/integration/global-setup.js';
import { getLogger } from '../observability/logger.js';
import { createE2eServer } from './server.js';

/**
 * Demarre le serveur du parcours de bout en bout, schema compris.
 *
 * Playwright le lance, attend `/health`, puis conduit le navigateur. La base
 * est refaite a neuf par les vraies migrations : le parcours part donc d'un
 * produit vide, comme un premier utilisateur.
 */

const url = process.env.TEST_DATABASE_URL;
if (url !== undefined && url !== '') {
  process.env.DATABASE_URL = url;
  process.env.DIRECT_DATABASE_URL = url;
}
process.env.NODE_ENV ??= 'test';
process.env.APP_URL ??= 'http://localhost:5174';
process.env.API_URL ??= 'http://localhost:3100';
process.env.SESSION_SECRET ??= 'parcours-de-bout-en-bout-secret-assez-long';
process.env.GOOGLE_CLIENT_ID ??= 'parcours';
process.env.GOOGLE_CLIENT_SECRET ??= 'parcours';
process.env.GOOGLE_CALLBACK_URL ??= 'http://localhost:3100/api/auth/google/callback';
process.env.REDIS_URL ??= 'redis://localhost:6379';
// Sans cle de chiffrement, le jeton Campaign Mailer ne peut pas etre garde :
// le parcours ne pourrait pas prouver l'envoi (S-01).
process.env.ENCRYPTION_KEY ??= 'a'.repeat(64);

await preparerBase();

const serveur = await createE2eServer();
const port = Number(process.env.E2E_PORT ?? 3100);

serveur.app.listen(port, () => {
  getLogger().info({ port, sites: serveur.sites.port }, 'parcours de bout en bout : pret');
});

const arreter = () => {
  void serveur.close().finally(() => {
    process.exit(0);
  });
};
process.on('SIGTERM', arreter);
process.on('SIGINT', arreter);
