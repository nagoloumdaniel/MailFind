import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * Une requete a la fois par domaine, et au moins un intervalle entre la fin
 * de l'une et le debut de la suivante (F-405).
 *
 * C'est une regle non negociable : un site de PME tient mal une rafale, et un
 * robot qui en envoie une merite d'etre bloque. Elle vaut pour tout MailFind,
 * pas seulement pour une tache : deux utilisateurs qui importent la meme
 * entreprise, traites par deux processus, ne doivent pas doubler le debit.
 * D'ou la version Redis, que tous les processus partagent. La version en
 * memoire sert aux tests.
 */
export interface DomainGate {
  run<T>(domain: string, intervalMs: number, task: () => Promise<T>): Promise<T>;
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export function createMemoryGate(): DomainGate {
  const files = new Map<string, Promise<void>>();
  const fins = new Map<string, number>();

  return {
    async run(domain, intervalMs, task) {
      const precedente = files.get(domain) ?? Promise.resolve();
      let liberer: () => void = () => undefined;
      const tour = new Promise<void>((resolve) => {
        liberer = resolve;
      });
      const suivante = precedente.then(() => tour);
      files.set(domain, suivante);

      await precedente;
      const attente = (fins.get(domain) ?? 0) + intervalMs - Date.now();
      if (attente > 0) await pause(attente);

      try {
        return await task();
      } finally {
        fins.set(domain, Date.now());
        liberer();
        // Rien ne suit : la file de ce domaine n'a plus a exister.
        if (files.get(domain) === suivante) files.delete(domain);
      }
    },
  };
}

/**
 * Reprend le verrou pour la duree de l'intervalle, a condition de le tenir
 * encore. Ecrit en Lua pour que la verification et l'ecriture ne fassent
 * qu'une operation : entre les deux, un autre processus aurait pu le prendre.
 */
const PROLONGER = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('set', KEYS[1], ARGV[1], 'PX', ARGV[2])
end
return nil`;

export function createRedisGate(
  redis: Redis,
  options: { prefix: string; holdMs: number },
): DomainGate {
  return {
    async run(domain, intervalMs, task) {
      const cle = `${options.prefix}:politesse:${domain}`;
      const jeton = randomUUID();

      // Le verrou est pose pour la duree maximale d'une requete : si le
      // processus meurt en la tenant, il se libere seul au lieu de bloquer le
      // domaine pour toujours.
      for (;;) {
        const pris = await redis.set(cle, jeton, 'PX', options.holdMs + intervalMs, 'NX');
        if (pris === 'OK') break;
        const reste = await redis.pttl(cle);
        await pause(Math.max(reste, 25));
      }

      try {
        return await task();
      } finally {
        // Le domaine reste reserve pendant l'intervalle qui suit la requete.
        await redis.eval(PROLONGER, 1, cle, jeton, String(intervalMs));
      }
    },
  };
}
