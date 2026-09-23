import { RedisStore } from 'connect-redis';
import type { RequestHandler } from 'express';
import session from 'express-session';
import { createClient } from 'redis';
import { getEnvironment } from '../config/env.js';
import { getLogger } from '../observability/logger.js';

// Une semaine. Assez long pour ne pas redemander une connexion tous les jours,
// assez court pour qu'un poste oublie finisse par se fermer.
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

declare module 'express-session' {
  interface SessionData {
    /** Compte connecte. Seule chose que la session retient de la personne. */
    userId?: string;
    /** Jeton anti-falsification de requete (S-09). */
    csrfToken?: string;
  }
}

/**
 * Sessions rangees dans Redis, pas en memoire : l'API tourne en plusieurs
 * instances et redemarre a chaque deploiement, or une session perdue a chaque
 * mise en ligne deconnecterait tout le monde.
 *
 * node-redis ici, et ioredis pour BullMQ : les deux clients ne sont pas
 * interchangeables, le melange est une panne deja rencontree sur Campaign
 * Mailer.
 */
export function createSessionMiddleware(): RequestHandler {
  const environment = getEnvironment();
  const client = createClient({ url: environment.REDIS_URL });

  client.on('error', (error: unknown) => {
    getLogger().error({ err: error }, 'client Redis de session en erreur');
  });

  // La connexion se fait en arriere plan : node-redis met en file les
  // commandes emises entre l'appel et son aboutissement.
  void client.connect();

  return session({
    store: new RedisStore({ client, prefix: environment.REDIS_SESSION_PREFIX }),
    name: 'mailfind.sid',
    secret: environment.SESSION_SECRET,
    // Pas de reecriture a chaque requete, et rien n'est ecrit tant que la
    // session est vide : un visiteur non connecte ne cree aucune cle.
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      // En developpement l'API est en clair sur localhost ; exiger `secure`
      // empecherait toute connexion.
      secure: environment.NODE_ENV === 'production',
      // `lax` et non `strict` : la redirection de retour de Google est une
      // navigation venue d'un autre site, et `strict` retiendrait le cookie,
      // donc perdrait la session au moment meme de la connexion.
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_MS,
    },
  });
}
