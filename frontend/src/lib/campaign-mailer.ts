import { apiFetch } from './api';
import type { ExportScope, StatusFilter } from './exports';

export interface CampaignMailerConnection {
  connected: boolean;
  /** Faux quand le serveur n'est pas configure pour joindre Campaign Mailer. */
  available: boolean;
  tokenPrefix: string | null;
  connectedAt: string | null;
  lastUsedAt: string | null;
}

/** La forme d'un jeton d'integration de Campaign Mailer, verifiee avant l'envoi. */
export function looksLikeCampaignMailerToken(valeur: string): boolean {
  return /^cm_[A-Za-z0-9_-]{43}$/.test(valeur.trim());
}

export interface CampaignMailerPush {
  id: string;
  campaignName: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  campaignId: string | null;
  campaignUrl: string | null;
  batchesTotal: number | null;
  batchesDone: number;
  sent: number;
  imported: number;
  rejected: number;
  skipped: number;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** Un envoi est fini quand il a reussi ou echoue ; la page cesse alors de le suivre. */
export function pushIsOver(push: Pick<CampaignMailerPush, 'status'>): boolean {
  return push.status === 'done' || push.status === 'failed';
}

export const campaignMailerApi = {
  connection: () => apiFetch<CampaignMailerConnection>('/api/campaign-mailer/connection'),
  connect: (token: string) =>
    apiFetch<CampaignMailerConnection>('/api/campaign-mailer/connection', {
      method: 'PUT',
      body: JSON.stringify({ token }),
    }),
  disconnect: () =>
    apiFetch<CampaignMailerConnection>('/api/campaign-mailer/connection', { method: 'DELETE' }),
  push: (campaignName: string, scope: ExportScope, statuses: StatusFilter) =>
    apiFetch<{ push: CampaignMailerPush }>('/api/campaign-mailer/pushes', {
      method: 'POST',
      body: JSON.stringify({ campaignName, scope, statuses }),
    }),
  pushStatus: (id: string) =>
    apiFetch<{ push: CampaignMailerPush }>(`/api/campaign-mailer/pushes/${encodeURIComponent(id)}`),
};
