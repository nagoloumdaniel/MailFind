import { query } from '../db/pool.js';
import { countExportRows, loadExportData, type ExportData } from '../exports/data.js';
import { campaignMailerAccepts, DEFAULT_SALUTATION } from '../exports/formats.js';
import type { ExportRequest, StatusFilter } from '../exports/request.js';
import { AppError } from '../http/problem.js';
import type { Cipher } from '../security/crypto.js';
import {
  CampaignMailerError,
  createCampaignMailerClient,
  type CampaignMailerClient,
  type CampaignMailerContact,
} from './client.js';
import { campaignMailerUrl, readToken, touchConnection } from './connection.js';

/**
 * Envoi d'une selection vers une campagne en brouillon de Campaign Mailer
 * (F-1202 a F-1209). Le premier lot cree le brouillon, les suivants s'y
 * ajoutent. Chaque lot porte la cle `mailfind-<envoi>-<rang>` : si la tache
 * meurt entre l'envoi d'un lot et l'enregistrement de sa progression, le lot
 * renvoye est rejoue par Campaign Mailer, jamais importe deux fois (A7).
 */

/** F-1205 : lots de 500 ; Campaign Mailer en accepte 2 000 par appel. */
export const BATCH_SIZE = 500;

export type PushScope = ExportRequest['scope'];

export interface PushRecord {
  readonly id: string;
  readonly campaignName: string;
  readonly status: 'pending' | 'running' | 'done' | 'failed';
  readonly campaignId: string | null;
  readonly campaignUrl: string | null;
  readonly batchesTotal: number | null;
  readonly batchesDone: number;
  readonly sent: number;
  readonly imported: number;
  readonly rejected: number;
  readonly skipped: number;
  readonly error: string | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

interface PushRow {
  id: string;
  user_id: string;
  campaign_name: string;
  request: { scope: PushScope; statuses: StatusFilter };
  status: PushRecord['status'];
  campaign_id: string | null;
  campaign_url: string | null;
  batches_total: number | null;
  batches_done: number;
  sent: number;
  imported: number;
  rejected: number;
  skipped: number;
  error: string | null;
  created_at: Date;
  completed_at: Date | null;
}

function versRecord(r: PushRow): PushRecord {
  return {
    id: r.id,
    campaignName: r.campaign_name,
    status: r.status,
    campaignId: r.campaign_id,
    campaignUrl: r.campaign_url,
    batchesTotal: r.batches_total,
    batchesDone: r.batches_done,
    sent: r.sent,
    imported: r.imported,
    rejected: r.rejected,
    skipped: r.skipped,
    error: r.error,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  };
}

function demandeExport(scope: PushScope, statuses: StatusFilter): ExportRequest {
  return { format: 'campaign_mailer', scope, statuses, bestOnly: false, separator: ';' };
}

const STATUTS_TRANSMIS = new Set(['valid', 'accept_all', 'risky', 'unknown', 'unverified']);

/**
 * Les contacts envoyes, a partir des donnees d'un export : une adresse une
 * fois, celles que Campaign Mailer refuserait comptees a part, et pour chacune
 * la page ou elle a ete trouvee et sa verification. Un statut autre que
 * `unverified` part avec sa date, ou ne part pas : Campaign Mailer refuserait
 * l'un sans l'autre, et une verification sans date ne dit rien.
 */
export function toCampaignMailerContacts(data: ExportData): {
  contacts: CampaignMailerContact[];
  skipped: number;
} {
  const vues = new Set<string>();
  const contacts: CampaignMailerContact[] = [];
  let skipped = 0;
  for (const c of data.companies) {
    for (const e of c.emails) {
      const email = e.address.trim().toLowerCase();
      if (vues.has(email)) continue;
      if (!campaignMailerAccepts(email)) {
        skipped += 1;
        continue;
      }
      vues.add(email);
      const page =
        e.sources.find((s) => s.url !== null && /^https?:\/\//.test(s.url))?.url ?? undefined;
      const salutation = e.salutation ?? (e.contactName === null ? DEFAULT_SALUTATION : null);
      const verifie =
        STATUTS_TRANSMIS.has(e.status) && e.status !== 'unverified' && e.verifiedAt !== null;
      contacts.push({
        email,
        ...(e.contactName === null ? {} : { contact_name: e.contactName }),
        company_name: c.name,
        ...(salutation === null ? {} : { salutation }),
        ...(page === undefined || page.length > 2000 ? {} : { source_url: page }),
        ...(e.status === 'unverified' ? { verification_status: 'unverified' as const } : {}),
        ...(verifie && e.verifiedAt !== null
          ? {
              verification_status: e.status as NonNullable<
                CampaignMailerContact['verification_status']
              >,
              verified_at: e.verifiedAt.toISOString(),
            }
          : {}),
      });
    }
  }
  return { contacts, skipped };
}

export async function createPush(
  userId: string,
  input: { campaignName: string; scope: PushScope; statuses: StatusFilter },
  enqueue: (pushId: string) => Promise<void>,
): Promise<PushRecord> {
  if (campaignMailerUrl() === undefined) {
    throw new AppError({
      status: 503,
      code: 'campaign_mailer_unavailable',
      title: 'Campaign Mailer indisponible',
      detail: "L'envoi vers Campaign Mailer n'est pas configure sur ce serveur.",
    });
  }
  const connexion = await query('select 1 from campaign_mailer_connections where user_id = $1', [
    userId,
  ]);
  if ((connexion.rowCount ?? 0) === 0) {
    throw new AppError({
      status: 409,
      code: 'campaign_mailer_not_connected',
      title: 'Campaign Mailer non connecte',
      detail: "Collez d'abord votre jeton Campaign Mailer dans la page Compte.",
    });
  }
  if ((await countExportRows(userId, demandeExport(input.scope, input.statuses))) === 0) {
    throw AppError.badRequest(
      'nothing_to_push',
      'Aucune adresse a envoyer',
      'La selection ne contient aucune adresse au statut choisi.',
    );
  }
  const cree = await query<PushRow>(
    `insert into campaign_mailer_pushes (user_id, campaign_name, request)
     values ($1, $2, $3::jsonb) returning *`,
    [userId, input.campaignName, JSON.stringify({ scope: input.scope, statuses: input.statuses })],
  );
  const ligne = cree.rows[0];
  if (ligne === undefined) throw new Error("L'envoi n'a pas ete enregistre.");
  await enqueue(ligne.id);
  return versRecord(ligne);
}

export async function findPush(userId: string, id: string): Promise<PushRecord | undefined> {
  const lignes = await query<PushRow>(
    `select * from campaign_mailer_pushes where id = $1 and user_id = $2`,
    [id, userId],
  );
  const ligne = lignes.rows[0];
  return ligne === undefined ? undefined : versRecord(ligne);
}

export async function listPushes(userId: string): Promise<PushRecord[]> {
  const lignes = await query<PushRow>(
    `select * from campaign_mailer_pushes
      where user_id = $1 order by created_at desc limit 20`,
    [userId],
  );
  return lignes.rows.map(versRecord);
}

async function echouer(id: string, message: string): Promise<void> {
  await query(
    `update campaign_mailer_pushes set status = 'failed', error = $2, completed_at = now()
      where id = $1`,
    [id, message],
  );
}

/**
 * La tache du processus de traitement. Elle repart du lot ou elle s'etait
 * arretee ; une erreur passagere est relancee par la file, une erreur
 * definitive (jeton refuse, brouillon lance entre-temps) arrete l'envoi et le
 * dit. `finalAttempt` : la derniere tentative laisse l'envoi en echec.
 */
export async function runPush(
  pushId: string,
  deps: {
    readonly cipher: Cipher | undefined;
    readonly client?: (token: string) => CampaignMailerClient;
    readonly finalAttempt: boolean;
  },
): Promise<void> {
  const lue = await query<PushRow>(
    `update campaign_mailer_pushes set status = 'running'
      where id = $1 and status in ('pending', 'running')
      returning *`,
    [pushId],
  );
  const envoi = lue.rows[0];
  if (envoi === undefined) return;

  const url = campaignMailerUrl();
  const jeton = deps.cipher === undefined ? undefined : await readToken(envoi.user_id, deps.cipher);
  if (url === undefined || jeton === undefined) {
    await echouer(pushId, 'Campaign Mailer est deconnecte : reconnectez-le depuis la page Compte.');
    return;
  }
  const client = deps.client?.(jeton) ?? createCampaignMailerClient({ baseUrl: url, token: jeton });

  // La selection est relue a chaque tentative : l'ordre est stable (celui de
  // l'export), si bien que le lot de rang n reste le meme d'une reprise a
  // l'autre tant que la bibliotheque ne change pas.
  const data = await loadExportData(
    envoi.user_id,
    demandeExport(envoi.request.scope, envoi.request.statuses),
  );
  const { contacts, skipped } = toCampaignMailerContacts(data);
  const lots: CampaignMailerContact[][] = [];
  for (let i = 0; i < contacts.length; i += BATCH_SIZE)
    lots.push(contacts.slice(i, i + BATCH_SIZE));
  await query('update campaign_mailer_pushes set batches_total = $2, skipped = $3 where id = $1', [
    pushId,
    lots.length,
    skipped,
  ]);

  if (lots.length === 0) {
    await echouer(pushId, "Aucune adresse de la selection n'est acceptee par Campaign Mailer.");
    return;
  }

  let campagne = envoi.campaign_id;
  try {
    for (let rang = envoi.batches_done; rang < lots.length; rang += 1) {
      const lot = lots[rang] ?? [];
      const cle = `mailfind-${pushId}-${String(rang)}`;
      const rapport =
        campagne === null
          ? await client.createDraft(envoi.campaign_name, lot, cle)
          : await client.addContacts(campagne, lot, cle);
      campagne = rapport.campaign.id;
      await query(
        `update campaign_mailer_pushes
            set campaign_id = $2, campaign_url = $3, batches_done = $4,
                sent = sent + $5, imported = imported + $6, rejected = rejected + $7
          where id = $1`,
        [
          pushId,
          rapport.campaign.id,
          rapport.campaign.url,
          rang + 1,
          lot.length,
          rapport.report.imported,
          rapport.report.rejected.length,
        ],
      );
    }
  } catch (error) {
    const definitive = !(error instanceof CampaignMailerError) || !error.retryable;
    if (definitive || deps.finalAttempt) {
      await echouer(pushId, error instanceof Error ? error.message : "L'envoi a echoue.");
      return;
    }
    throw error;
  }

  await query(
    `update campaign_mailer_pushes set status = 'done', completed_at = now() where id = $1`,
    [pushId],
  );
  await touchConnection(envoi.user_id);
}
