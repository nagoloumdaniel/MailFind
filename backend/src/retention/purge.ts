import { query } from '../db/pool.js';
import { getLogger } from '../observability/logger.js';

/**
 * Conservation et purge automatique (R-06).
 *
 * Trois durees, parce que les trois choses ne servent pas a la meme chose :
 *
 * - une adresse et ses sources, douze mois sans servir. C'est une donnee
 *   personnelle collectee sur le web : la garder sans usage ne se justifie
 *   pas, et une adresse vieille d'un an a de bonnes chances d'etre fausse ;
 * - le journal d'audit, douze mois. Il sert a repondre « qui a fait quoi »,
 *   y compris a une personne qui exerce ses droits ;
 * - les traces techniques, quatre-vingt-dix jours. Elles servent a comprendre
 *   une panne, pas a faire de l'histoire.
 *
 * La purge efface par paquets : une suppression d'un seul tenant sur une
 * grande table tient un verrou le temps qu'elle dure, et ferait attendre le
 * pipeline.
 */

export const EMAIL_RETENTION_MONTHS = 12;
export const AUDIT_RETENTION_MONTHS = 12;
export const TECHNICAL_RETENTION_DAYS = 90;

/** Au plus par passage, pour que la tache reste courte et reprenne demain. */
const PAQUET = 5000;

export interface PurgeReport {
  readonly emails: number;
  readonly auditEvents: number;
  readonly providerCalls: number;
  readonly verifications: number;
  readonly webhookDeliveries: number;
}

async function effacerParPaquets(sql: string, parametres: unknown[]): Promise<number> {
  let total = 0;
  for (;;) {
    const issue = await query(sql, parametres);
    const efface = issue.rowCount ?? 0;
    total += efface;
    if (efface < PAQUET) return total;
  }
}

export async function purgeExpiredData(): Promise<PurgeReport> {
  // Les sources partent avec leur adresse : la base les lie en cascade, et
  // une source sans adresse n'aurait aucun sens.
  const emails = await effacerParPaquets(
    `delete from emails where id in (
       select id from emails
        where last_used_at < now() - make_interval(months => $1)
        limit ${String(PAQUET)}
     )`,
    [EMAIL_RETENTION_MONTHS],
  );

  const auditEvents = await effacerParPaquets(
    `delete from audit_events where id in (
       select id from audit_events
        where created_at < now() - make_interval(months => $1)
        limit ${String(PAQUET)}
     )`,
    [AUDIT_RETENTION_MONTHS],
  );

  // Les appels payants gardent leur trace le temps d'une contestation de
  // facture, pas davantage : ils ne portent ni adresse ni contenu.
  const providerCalls = await effacerParPaquets(
    `delete from provider_calls where id in (
       select id from provider_calls
        where created_at < now() - make_interval(days => $1)
        limit ${String(PAQUET)}
     )`,
    [TECHNICAL_RETENTION_DAYS],
  );

  const verifications = await effacerParPaquets(
    `delete from verifications where id in (
       select id from verifications
        where verified_at < now() - make_interval(days => $1)
        limit ${String(PAQUET)}
     )`,
    [TECHNICAL_RETENTION_DAYS],
  );

  const webhookDeliveries = await effacerParPaquets(
    `delete from webhook_deliveries where id in (
       select id from webhook_deliveries
        where created_at < now() - make_interval(days => $1)
        limit ${String(PAQUET)}
     )`,
    [TECHNICAL_RETENTION_DAYS],
  );

  const rapport = { emails, auditEvents, providerCalls, verifications, webhookDeliveries };
  const total = Object.values(rapport).reduce((somme, n) => somme + n, 0);
  if (total > 0) getLogger().info(rapport, 'purge de conservation');
  return rapport;
}

/**
 * Marque des adresses comme ayant servi. Appelee a l'export et a l'envoi :
 * ce sont les deux moments ou une adresse quitte MailFind pour etre utilisee.
 */
export async function markEmailsUsed(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await query(`update emails set last_used_at = now() where id = any($1::uuid[])`, [ids]);
}
