import { apiFetch } from './api';

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

export const campaignMailerApi = {
  connection: () => apiFetch<CampaignMailerConnection>('/api/campaign-mailer/connection'),
  connect: (token: string) =>
    apiFetch<CampaignMailerConnection>('/api/campaign-mailer/connection', {
      method: 'PUT',
      body: JSON.stringify({ token }),
    }),
  disconnect: () =>
    apiFetch<CampaignMailerConnection>('/api/campaign-mailer/connection', { method: 'DELETE' }),
};
