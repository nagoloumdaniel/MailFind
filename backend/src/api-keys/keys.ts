import { createHash, randomBytes } from 'node:crypto';

/**
 * Cles de l'API publique (F-1302, S-02).
 *
 * Une cle est `mf_` suivi de 32 octets tires au hasard, en base64url. Elle
 * est montree une seule fois, a sa creation ; seuls son prefixe, pour la
 * reconnaitre dans la page Compte, et son empreinte SHA-256, pour la
 * retrouver, sont gardes. Le prefixe `mf_` permet aux outils de detection de
 * secrets de la reperer dans un depot.
 */

/** F-1303, dans l'ordre du cahier des charges. */
export const API_SCOPES = [
  'companies:read',
  'companies:write',
  'emails:read',
  'imports:write',
  'verify',
  'exports:write',
  'integrations:write',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

const FORME = /^mf_[A-Za-z0-9_-]{43}$/;
const LONGUEUR_PREFIXE = 11;

export interface GeneratedApiKey {
  readonly secret: string;
  readonly prefix: string;
  readonly hash: string;
}

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function generateApiKey(): GeneratedApiKey {
  const secret = `mf_${randomBytes(32).toString('base64url')}`;
  return { secret, prefix: secret.slice(0, LONGUEUR_PREFIXE), hash: hashApiKey(secret) };
}

/** Une valeur qui n'a pas la forme d'une cle est refusee sans requete en base. */
export function looksLikeApiKey(valeur: string): boolean {
  return FORME.test(valeur);
}
