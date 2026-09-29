import { query } from '../db/pool.js';
import { getLogger } from '../observability/logger.js';
import { isSuppressed, loadSuppressedHashes } from '../suppressions/repository.js';
import { createDisposableCache, isDisposableIn } from './disposable.js';
import { createMailDns, type MailDns } from './local.js';
import { checkAddressList, type OneOffResult } from './one-off.js';

/**
 * Verification d'une liste en tache (6.13, `POST /v1/verify` au-dela de 100
 * adresses). Les memes controles gratuits que la verification ponctuelle
 * (F-705), faits par le processus de traitement ; le resultat attend le
 * client sept jours.
 */

export const DIRECT_MAX = 100;
export const RUN_MAX = 10_000;
const RETENTION = "interval '7 days'";

export interface VerificationRun {
  readonly id: string;
  readonly status: 'pending' | 'running' | 'done' | 'failed';
  readonly total: number;
  readonly results: OneOffResult[] | null;
  readonly error: string | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

interface Ligne {
  id: string;
  status: VerificationRun['status'];
  total: number;
  results: OneOffResult[] | null;
  error: string | null;
  created_at: Date;
  completed_at: Date | null;
}

function versRun(l: Ligne): VerificationRun {
  return {
    id: l.id,
    status: l.status,
    total: l.total,
    results: l.results,
    error: l.error,
    createdAt: l.created_at,
    completedAt: l.completed_at,
  };
}

export async function createVerificationRun(
  userId: string,
  addresses: readonly string[],
): Promise<VerificationRun> {
  const lignes = await query<Ligne>(
    `insert into verification_runs (user_id, addresses) values ($1, $2::text[])
     returning id, status::text as status, cardinality(addresses) as total, results, error,
               created_at, completed_at`,
    [userId, addresses],
  );
  const ligne = lignes.rows[0];
  if (ligne === undefined) throw new Error("La verification n'a pas ete enregistree.");
  return versRun(ligne);
}

export async function findVerificationRun(
  userId: string,
  id: string,
): Promise<VerificationRun | undefined> {
  const lignes = await query<Ligne>(
    `select id, status::text as status, cardinality(addresses) as total, results, error,
            created_at, completed_at
       from verification_runs where id = $1 and user_id = $2`,
    [id, userId],
  );
  const ligne = lignes.rows[0];
  return ligne === undefined ? undefined : versRun(ligne);
}

let dnsParDefaut: MailDns | undefined;
const jetables = createDisposableCache();

/**
 * La tache du processus de traitement. Rejouee apres une coupure, elle
 * refait le travail en entier : il est gratuit, et rien n'a ete rendu.
 */
export async function runVerification(id: string, dns?: MailDns): Promise<void> {
  const prise = await query<{ user_id: string; addresses: string[] }>(
    `update verification_runs set status = 'running'
      where id = $1 and status in ('pending', 'running')
      returning user_id, addresses`,
    [id],
  );
  const run = prise.rows[0];
  if (run === undefined) return;
  try {
    const supprimees = await loadSuppressedHashes(run.user_id);
    const domaines = await jetables();
    const results = await checkAddressList(run.addresses, {
      dns: dns ?? (dnsParDefaut ??= createMailDns()),
      isDisposable: (domaine) => isDisposableIn(domaines, domaine),
      isSuppressed: (adresse) => isSuppressed(supprimees, adresse),
    });
    await query(
      `update verification_runs set status = 'done', results = $2::jsonb, completed_at = now()
        where id = $1`,
      [id, JSON.stringify(results)],
    );
  } catch (error) {
    getLogger().error({ err: error, verificationRunId: id }, 'verification en tache en echec');
    await query(
      `update verification_runs set status = 'failed', error = $2, completed_at = now()
        where id = $1`,
      [id, 'La verification a echoue. Relancez-la.'],
    );
  }
}

/** Entretien quotidien : les verifications de plus de sept jours sont effacees. */
export async function purgeExpiredVerificationRuns(): Promise<number> {
  const resultat = await query(
    `delete from verification_runs where created_at < now() - ${RETENTION}`,
  );
  return resultat.rowCount ?? 0;
}
