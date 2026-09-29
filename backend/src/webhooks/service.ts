import { randomUUID } from 'node:crypto';
import { getPool, query } from '../db/pool.js';
import { AppError } from '../http/problem.js';
import { isForbiddenHostname } from '../net/addresses.js';
import type { Fetcher } from '../net/safe-fetch.js';
import { getLogger } from '../observability/logger.js';
import { enqueueWebhookDelivery } from '../queue/queues.js';
import type { Cipher } from '../security/crypto.js';
import { generateWebhookSecret, SIGNATURE_HEADER, signWebhook } from './signature.js';

/**
 * Webhooks de l'API publique (F-1308) : abonnements, evenements, livraisons.
 *
 * Les evenements sont minces : l'identifiant et le statut de la ressource,
 * et ce qu'il faut pour decider sans appel de plus. Le reste se lit par
 * l'API, ou l'etat est toujours a jour ; un evenement, lui, peut arriver en
 * retard ou deux fois, et le destinataire deduplique par son `id`.
 */

export const WEBHOOK_EVENTS = [
  'import.completed',
  'import.failed',
  'verification.completed',
  'export.ready',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Au-dela, un abonnement de plus n'a pas d'usage : il multiplie les envois. */
export const MAX_WEBHOOKS = 10;
/** F-1308 : trois nouvelles tentatives apres la premiere. */
export const DELIVERY_ATTEMPTS = 4;
const DELAI_MS = 10_000;
const USER_AGENT = 'MailFind-Webhooks/1.0 (+https://mailfind.app/bot)';

export interface WebhookSummary {
  readonly id: string;
  readonly url: string;
  readonly events: readonly WebhookEvent[];
  readonly description: string | null;
  readonly secret_prefix: string;
  readonly created_at: Date;
}

const COLONNES = 'id, url, events, description, secret_prefix, created_at';

export async function createWebhook(
  userId: string,
  input: { url: string; events: readonly WebhookEvent[]; description?: string | undefined },
  cipher: Cipher | undefined,
): Promise<{ webhook: WebhookSummary; secret: string }> {
  if (cipher === undefined) {
    throw new AppError({
      status: 503,
      code: 'encryption_unavailable',
      title: 'Webhooks indisponibles',
      detail: "Le chiffrement des secrets n'est pas configure sur ce serveur.",
    });
  }
  const url = new URL(input.url);
  // La resolution DNS est regardee a chaque envoi ; ici, on refuse ce qui est
  // interdit d'emblee, pour le dire a la creation plutot qu'au premier echec.
  if (url.protocol !== 'https:' || isForbiddenHostname(url.hostname)) {
    throw AppError.badRequest(
      'invalid_webhook_url',
      'URL refusee',
      'Une URL https publique : ni adresse privee, ni machine locale, ni metadonnees.',
    );
  }
  const secret = generateWebhookSecret();
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`webhooks:${userId}`]);
    const cree = await client.query<WebhookSummary>(
      `insert into webhooks (user_id, url, events, secret_encrypted, secret_prefix, description)
       select $1, $2, $3::text[], $4, $5, $6
        where (select count(*) from webhooks where user_id = $1 and deleted_at is null) < $7
       returning ${COLONNES}`,
      [
        userId,
        url.toString(),
        [...new Set(input.events)],
        cipher.encrypt(secret),
        secret.slice(0, 12),
        input.description ?? null,
        MAX_WEBHOOKS,
      ],
    );
    await client.query('commit');
    const webhook = cree.rows[0];
    if (webhook === undefined) {
      throw new AppError({
        status: 409,
        code: 'webhook_limit_reached',
        title: "Trop d'abonnements",
        detail: `Supprimez un abonnement avant d'en creer un autre (${String(MAX_WEBHOOKS)} au plus).`,
      });
    }
    return { webhook, secret };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listWebhooks(userId: string): Promise<WebhookSummary[]> {
  const lignes = await query<WebhookSummary>(
    `select ${COLONNES} from webhooks where user_id = $1 and deleted_at is null
      order by created_at desc`,
    [userId],
  );
  return lignes.rows;
}

/** Retire l'abonnement ; son journal de livraisons reste lisible. */
export async function deleteWebhook(userId: string, id: string): Promise<boolean> {
  const resultat = await query(
    `update webhooks set deleted_at = now()
      where id = $1 and user_id = $2 and deleted_at is null`,
    [id, userId],
  );
  return (resultat.rowCount ?? 0) > 0;
}

export async function ownsWebhook(userId: string, id: string): Promise<boolean> {
  const lignes = await query('select 1 from webhooks where id = $1 and user_id = $2', [id, userId]);
  return (lignes.rowCount ?? 0) > 0;
}

/**
 * Un evenement pour un compte : une livraison par abonnement qui le veut,
 * puis mise en file. Une panne ici ne doit jamais faire echouer ce qui l'a
 * declenche (un import termine reste termine) : elle est journalisee.
 */
export async function emitWebhookEvent(
  userId: string,
  type: WebhookEvent,
  data: Record<string, unknown>,
  maintenant = new Date(),
): Promise<void> {
  try {
    const abonnements = await query<{ id: string }>(
      `select id from webhooks
        where user_id = $1 and deleted_at is null and $2 = any(events)`,
      [userId, type],
    );
    if (abonnements.rows.length === 0) return;
    const eventId = randomUUID();
    const payload = JSON.stringify({
      id: eventId,
      type,
      created_at: maintenant.toISOString(),
      data,
    });
    const creees = await query<{ id: string }>(
      `insert into webhook_deliveries (webhook_id, event_id, event_type, payload)
       select unnest($1::uuid[]), $2, $3, $4
       on conflict (webhook_id, event_id) do nothing
       returning id`,
      [abonnements.rows.map((a) => a.id), eventId, type, payload],
    );
    for (const livraison of creees.rows) await enqueueWebhookDelivery(livraison.id);
  } catch (error) {
    getLogger().error({ err: error, type }, 'evenement de webhook non emis');
  }
}

interface Livraison {
  id: string;
  event_type: string;
  payload: string;
  url: string;
  secret_encrypted: string;
  deleted_at: Date | null;
}

/**
 * Une tentative de livraison, faite par le processus de traitement. Un 2xx
 * la regle ; tout le reste (autre statut, 3xx non suivi, delai, adresse
 * refusee) leve une erreur pour que BullMQ retente, jusqu'a la derniere
 * tentative, qui laisse la livraison en echec dans le journal.
 */
export async function deliverWebhook(
  deliveryId: string,
  deps: { fetcher: Fetcher; cipher: Cipher | undefined; finalAttempt: boolean },
): Promise<void> {
  const lue = await query<Livraison>(
    `select d.id, d.event_type, d.payload, w.url, w.secret_encrypted, w.deleted_at
       from webhook_deliveries d join webhooks w on w.id = d.webhook_id
      where d.id = $1 and d.status = 'pending'`,
    [deliveryId],
  );
  const livraison = lue.rows[0];
  if (livraison === undefined) return;
  const noter = (
    statut: 'pending' | 'succeeded' | 'failed',
    code: number | null,
    erreur: string | null,
  ) =>
    query(
      `update webhook_deliveries
          set status = $2::webhook_delivery_status, attempts = attempts + 1,
              last_status_code = $3, last_error = $4, last_attempt_at = now(),
              delivered_at = case when $2 = 'succeeded' then now() else delivered_at end
        where id = $1`,
      [deliveryId, statut, code, erreur],
    );

  if (livraison.deleted_at !== null) {
    await noter('failed', null, 'Abonnement supprime avant la livraison.');
    return;
  }
  if (deps.cipher === undefined) throw new Error('Chiffrement non configure : secret illisible.');

  let code: number | null = null;
  let erreur: string;
  try {
    const secret = deps.cipher.decrypt(livraison.secret_encrypted);
    const reponse = await deps.fetcher.postJson(
      livraison.url,
      livraison.payload,
      {
        [SIGNATURE_HEADER]: signWebhook(secret, livraison.payload),
        'MailFind-Event': livraison.event_type,
        'MailFind-Delivery': livraison.id,
        'user-agent': USER_AGENT,
      },
      { timeoutMs: DELAI_MS },
    );
    code = reponse.status;
    if (code >= 200 && code < 300) {
      await noter('succeeded', code, null);
      return;
    }
    erreur = `Le destinataire a repondu ${String(code)}.`;
  } catch (error) {
    erreur = error instanceof Error ? error.message.slice(0, 300) : 'Erreur de livraison.';
  }
  await noter(deps.finalAttempt ? 'failed' : 'pending', code, erreur);
  if (!deps.finalAttempt) throw new Error(erreur);
}

export interface DeliveryRecord {
  readonly id: string;
  readonly event_id: string;
  readonly event_type: string;
  readonly status: 'pending' | 'succeeded' | 'failed';
  readonly attempts: number;
  readonly last_status_code: number | null;
  readonly last_error: string | null;
  readonly created_at: Date;
  readonly last_attempt_at: Date | null;
  readonly delivered_at: Date | null;
}

export const DELIVERY_COLUMNS = `d.id, d.event_id, d.event_type, d.status::text as status, d.attempts,
  d.last_status_code, d.last_error, d.created_at, d.last_attempt_at, d.delivered_at`;
