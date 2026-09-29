import { apiFetch } from './api';

/** F-1303, dans l'ordre du cahier des charges, avec ce que chaque portee permet. */
export const API_SCOPES = [
  { value: 'companies:read', label: 'Lire les entreprises' },
  { value: 'companies:write', label: 'Modifier les entreprises' },
  { value: 'emails:read', label: 'Lire les adresses' },
  { value: 'imports:write', label: 'Lancer des imports' },
  { value: 'verify', label: 'Verifier des adresses' },
  { value: 'exports:write', label: 'Creer des exports' },
  { value: 'integrations:write', label: 'Envoyer vers Campaign Mailer' },
] as const;

export type ApiScope = (typeof API_SCOPES)[number]['value'];

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export function scopeLabel(scope: ApiScope): string {
  return API_SCOPES.find((s) => s.value === scope)?.label ?? scope;
}

/** « jamais », sinon le jour : l'heure exacte n'aide pas a savoir si une cle sert encore. */
export function lastUsedLabel(key: Pick<ApiKey, 'lastUsedAt'>): string {
  return key.lastUsedAt === null
    ? 'Jamais utilisee'
    : `Utilisee le ${new Date(key.lastUsedAt).toLocaleDateString('fr-FR')}`;
}

export function listApiKeys(): Promise<{ keys: ApiKey[]; maxActive: number }> {
  return apiFetch('/api/account/api-keys');
}

export function createApiKey(
  name: string,
  scopes: readonly ApiScope[],
): Promise<{ key: ApiKey; secret: string }> {
  return apiFetch('/api/account/api-keys', {
    method: 'POST',
    body: JSON.stringify({ name, scopes }),
  });
}

export function revokeApiKey(id: string): Promise<{ key: ApiKey }> {
  return apiFetch(`/api/account/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
