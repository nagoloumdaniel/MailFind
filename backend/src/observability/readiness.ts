import { query } from '../db/pool.js';
import { getQueueConnection } from '../queue/connection.js';
import { COMPANY_QUEUE, IMPORT_QUEUE, MAINTENANCE_QUEUE } from '../queue/queues.js';

/**
 * `/ready` : les dependances repondent-elles, et le travail avance-t-il
 * (section 12) ?
 *
 * A distinguer de `/health`, qui dit seulement que le processus est en vie.
 * L'hebergeur redemarre sur `/health` ; `/ready` sert a un humain et a une
 * sonde, et ne doit jamais provoquer un redemarrage parce que la base est
 * lente.
 *
 * Chaque sonde a son propre delai : une dependance muette doit rendre un
 * verdict, pas faire attendre la page indefiniment.
 */

const DELAI_MS = 3000;

export type CheckStatus = 'ok' | 'failed' | 'degraded';

export interface Check {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail?: string;
  readonly ms: number;
}

/**
 * Le processus de traitement ecrit sa presence ici, avec une duree de vie.
 * Sans lui, la cle expire et `/ready` le dit : c'est la seule facon de
 * distinguer « aucune tache en attente » de « personne ne les prend ».
 */
export const HEARTBEAT_KEY = 'worker:heartbeat';
/** Trois fois la periode d'ecriture : un retard ponctuel n'alerte pas. */
export const HEARTBEAT_TTL_SECONDS = 90;

export async function writeWorkerHeartbeat(): Promise<void> {
  await getQueueConnection().set(
    HEARTBEAT_KEY,
    new Date().toISOString(),
    'EX',
    HEARTBEAT_TTL_SECONDS,
  );
}

async function mesurer(
  name: string,
  sonde: () => Promise<{ status: CheckStatus; detail?: string }>,
): Promise<Check> {
  const depart = Date.now();
  try {
    const issue = await Promise.race([
      sonde(),
      new Promise<never>((_, rejeter) =>
        setTimeout(() => {
          rejeter(new Error(`pas de reponse en ${String(DELAI_MS)} ms`));
        }, DELAI_MS).unref(),
      ),
    ]);
    return { name, ...issue, ms: Date.now() - depart };
  } catch (error) {
    return {
      name,
      status: 'failed',
      detail: error instanceof Error ? error.message : 'erreur',
      ms: Date.now() - depart,
    };
  }
}

export interface QueueDepth {
  readonly name: string;
  readonly waiting: number;
  readonly active: number;
  readonly failed: number;
}

export interface ReadinessReport {
  readonly ready: boolean;
  readonly checks: Check[];
  readonly queues: QueueDepth[];
  /** Depuis quand le processus de traitement n'a pas donne signe de vie. */
  readonly workerSeenAt: string | null;
}

/** Profondeur des files, sans instancier de `Queue` : une lecture suffit. */
async function profondeurs(prefix: string): Promise<QueueDepth[]> {
  const redis = getQueueConnection();
  const files = [IMPORT_QUEUE, COMPANY_QUEUE, MAINTENANCE_QUEUE];
  return Promise.all(
    files.map(async (name) => {
      const [waiting, active, failed] = await Promise.all([
        redis.llen(`${prefix}:${name}:wait`),
        redis.llen(`${prefix}:${name}:active`),
        redis.zcard(`${prefix}:${name}:failed`),
      ]);
      return { name, waiting, active, failed };
    }),
  );
}

export async function checkReadiness(prefix: string): Promise<ReadinessReport> {
  let vuLe: string | null = null;
  let files: QueueDepth[] = [];

  const checks = await Promise.all([
    mesurer('database', async () => {
      await query('select 1');
      return { status: 'ok' as const };
    }),
    mesurer('redis', async () => {
      const reponse: string = await getQueueConnection().ping();
      return reponse === 'PONG'
        ? { status: 'ok' as const }
        : { status: 'failed' as const, detail: `reponse inattendue : ${reponse}` };
    }),
    mesurer('queues', async () => {
      files = await profondeurs(prefix);
      return { status: 'ok' as const };
    }),
    mesurer('worker', async () => {
      vuLe = await getQueueConnection().get(HEARTBEAT_KEY);
      return vuLe === null
        ? {
            status: 'degraded' as const,
            detail: `aucun signe depuis au moins ${String(HEARTBEAT_TTL_SECONDS)} s : les imports resteront en attente`,
          }
        : { status: 'ok' as const };
    }),
  ]);

  // « Pret » veut dire que l'API peut repondre : une base ou un Redis muet
  // l'en empeche. Un processus de traitement arrete est grave, mais l'API
  // repond encore, et le dire « non pret » ferait retirer l'instance du
  // service sans raison.
  return {
    ready: !checks.some((check) => check.status === 'failed'),
    checks,
    queues: files,
    workerSeenAt: vuLe,
  };
}
