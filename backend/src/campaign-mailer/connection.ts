import { getEnvironment } from '../config/env.js';
import { query } from '../db/pool.js';
import { AppError } from '../http/problem.js';
import type { Cipher } from '../security/crypto.js';

/**
 * La connexion d'un compte a Campaign Mailer (F-1201) : le jeton d'integration
 * personnel que l'utilisateur a cree dans sa page Compte de Campaign Mailer,
 * garde chiffre (S-01). MailFind ne voit jamais la session Google de
 * Campaign Mailer, et Campaign Mailer jamais celle de MailFind.
 */

const FORME = /^cm_[A-Za-z0-9_-]{43}$/;

export interface ConnectionSummary {
  readonly connected: boolean;
  /** Faux quand l'exploitant n'a pas configure l'adresse de Campaign Mailer. */
  readonly available: boolean;
  readonly tokenPrefix: string | null;
  readonly connectedAt: Date | null;
  readonly lastUsedAt: Date | null;
}

export function campaignMailerUrl(): string | undefined {
  const url = getEnvironment().CAMPAIGN_MAILER_API_URL.trim().replace(/\/+$/, '');
  return url === '' ? undefined : url;
}

export async function getConnection(userId: string): Promise<ConnectionSummary> {
  const lignes = await query<{
    token_prefix: string;
    connected_at: Date;
    last_used_at: Date | null;
  }>(
    `select token_prefix, connected_at, last_used_at
       from campaign_mailer_connections where user_id = $1`,
    [userId],
  );
  const ligne = lignes.rows[0];
  return {
    connected: ligne !== undefined,
    available: campaignMailerUrl() !== undefined,
    tokenPrefix: ligne?.token_prefix ?? null,
    connectedAt: ligne?.connected_at ?? null,
    lastUsedAt: ligne?.last_used_at ?? null,
  };
}

/** Enregistre ou remplace le jeton ; il ne sera plus jamais rendu en clair. */
export async function saveConnection(
  userId: string,
  token: string,
  cipher: Cipher | undefined,
): Promise<ConnectionSummary> {
  if (cipher === undefined) {
    throw new AppError({
      status: 503,
      code: 'encryption_unavailable',
      title: 'Connexion indisponible',
      detail: "Le chiffrement des secrets n'est pas configure sur ce serveur.",
    });
  }
  const jeton = token.trim();
  if (!FORME.test(jeton)) {
    throw AppError.badRequest(
      'invalid_campaign_mailer_token',
      'Jeton refuse',
      "Collez le jeton d'integration tel que Campaign Mailer l'a affiche : il commence par cm_.",
    );
  }
  await query(
    `insert into campaign_mailer_connections (user_id, token_encrypted, token_prefix)
     values ($1, $2, $3)
     on conflict (user_id) do update
       set token_encrypted = excluded.token_encrypted, token_prefix = excluded.token_prefix,
           connected_at = now(), last_used_at = null`,
    [userId, cipher.encrypt(jeton), jeton.slice(0, 11)],
  );
  return getConnection(userId);
}

export async function deleteConnection(userId: string): Promise<boolean> {
  const resultat = await query('delete from campaign_mailer_connections where user_id = $1', [
    userId,
  ]);
  return (resultat.rowCount ?? 0) > 0;
}

/** Le jeton en clair, pour un appel a Campaign Mailer ; undefined sans connexion. */
export async function readToken(userId: string, cipher: Cipher): Promise<string | undefined> {
  const lignes = await query<{ token_encrypted: string }>(
    'select token_encrypted from campaign_mailer_connections where user_id = $1',
    [userId],
  );
  const chiffre = lignes.rows[0]?.token_encrypted;
  return chiffre === undefined ? undefined : cipher.decrypt(chiffre);
}

export async function touchConnection(userId: string): Promise<void> {
  await query('update campaign_mailer_connections set last_used_at = now() where user_id = $1', [
    userId,
  ]);
}
