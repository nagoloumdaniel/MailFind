import { Redis } from 'ioredis';
import { getEnvironment } from '../config/env.js';

/**
 * Connexion Redis des files.
 *
 * ioredis ici, node-redis pour les sessions. Les deux clients ne sont pas
 * interchangeables, et les melanger est une panne deja rencontree sur Campaign
 * Mailer.
 */
let connexion: Redis | undefined;

export function getQueueConnection(): Redis {
  connexion ??= new Redis(getEnvironment().REDIS_URL, {
    // BullMQ l'exige : ses lectures bloquantes durent plus longtemps que le
    // delai par defaut d'ioredis, qui les abandonnerait en pleine attente.
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return connexion;
}

export async function closeQueueConnection(): Promise<void> {
  if (connexion === undefined) return;
  const fermeture = connexion;
  connexion = undefined;
  await fermeture.quit();
}

/** Prefixe commun, pour qu'une base partagee reste lisible (D-05). */
export function queuePrefix(): string {
  return getEnvironment().BULLMQ_PREFIX;
}
