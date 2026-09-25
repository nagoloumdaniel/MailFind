import { query } from '../db/pool.js';

/**
 * Journal d'audit (R-06). Les actions sont des chaines stables en anglais,
 * comme les codes d'erreur : elles sont lues par des programmes et par des
 * requetes, pas par des utilisateurs.
 */
export type AuditAction =
  | 'user.signed_up'
  | 'user.signed_in'
  | 'user.signed_out'
  | 'user.accepted_terms'
  | 'user.exported_data'
  | 'user.deleted'
  | 'import.created';

export interface AuditEvent {
  readonly userId: string | null;
  readonly action: AuditAction;
  readonly entity: string;
  readonly entityId?: string | null;
  /**
   * Jamais d'adresse email en clair, jamais de secret (S-03). Des identifiants,
   * des versions, des compteurs.
   */
  readonly metadata?: Record<string, unknown>;
}

export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  await query(
    `insert into audit_events (user_id, action, entity, entity_id, metadata)
     values ($1, $2, $3, $4, $5)`,
    [
      event.userId,
      event.action,
      event.entity,
      event.entityId ?? null,
      JSON.stringify(event.metadata ?? {}),
    ],
  );
}
