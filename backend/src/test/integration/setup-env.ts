/**
 * Les tests d'integration parlent a une vraie base : sa chaine remplace la
 * fausse avant que le moindre module ne lise l'environnement.
 */
const url = process.env.TEST_DATABASE_URL;
if (url !== undefined && url !== '') {
  process.env.DATABASE_URL = url;
  process.env.DIRECT_DATABASE_URL = url;
}

await import('../setup-env.js');
