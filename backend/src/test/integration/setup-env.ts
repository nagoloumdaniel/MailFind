/**
 * Les tests d'integration parlent a une vraie base : sa chaine remplace la
 * fausse avant que le moindre module ne lise l'environnement.
 */
const url = process.env.TEST_DATABASE_URL;
if (url !== undefined && url !== '') {
  process.env.DATABASE_URL = url;
  process.env.DIRECT_DATABASE_URL = url;
}

/**
 * Et le Redis des files, quand il y en a un : sans cela, ce qui lit
 * `REDIS_URL` viserait l'instance de developpement, ou rien.
 */
const redis = process.env.TEST_REDIS_URL;
if (redis !== undefined && redis !== '') {
  process.env.REDIS_URL = redis;
  // Un prefixe propre a la suite : deux series de tests ne doivent pas lire
  // les files l'une de l'autre.
  process.env.BULLMQ_PREFIX = 'mailfind:test:bull';
}

await import('../setup-env.js');
