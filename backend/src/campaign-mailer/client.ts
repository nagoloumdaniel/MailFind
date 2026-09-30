import { z } from 'zod';

/**
 * Client de l'API v1 de Campaign Mailer (F-1202), selon son document
 * OpenAPI (`/api/v1/openapi.json`) : creer un brouillon avec ses contacts,
 * puis ajouter des contacts a ce brouillon. Chaque appel porte une cle
 * d'idempotence, que Campaign Mailer exige.
 */

/** Un contact tel que Campaign Mailer le recoit : ses quatre champs et la provenance MailFind. */
export interface CampaignMailerContact {
  readonly email: string;
  readonly contact_name?: string;
  readonly company_name?: string;
  readonly salutation?: string;
  readonly source_url?: string;
  readonly verification_status?: 'valid' | 'accept_all' | 'risky' | 'unknown' | 'unverified';
  readonly verified_at?: string;
}

const reponseSchema = z.object({
  campaign: z.object({
    id: z.string(),
    name: z.string(),
    status: z.string(),
    url: z.string(),
  }),
  report: z.object({
    read: z.number().int(),
    imported: z.number().int(),
    rejected: z.array(z.object({ line: z.number(), email: z.string(), reason: z.string() })),
  }),
});

export type CampaignMailerReport = z.infer<typeof reponseSchema>;

/**
 * Pourquoi Campaign Mailer n'a pas pris un lot. `retryable` dit si la meme
 * requete, sous la meme cle, peut reussir plus tard : un debit depasse ou une
 * panne oui, un jeton refuse ou un brouillon deja lance non.
 */
export class CampaignMailerError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'CampaignMailerError';
  }
}

function erreurPour(status: number, code: string | undefined): CampaignMailerError {
  if (status === 401) {
    return new CampaignMailerError(
      'Jeton Campaign Mailer refuse : reconnectez Campaign Mailer depuis la page Compte.',
      false,
      status,
      code,
    );
  }
  if (status === 403) {
    return new CampaignMailerError(
      code === 'terms_not_accepted'
        ? 'Acceptez les conditions de Campaign Mailer avant tout envoi.'
        : "Ce jeton Campaign Mailer n'a pas les deux autorisations requises.",
      false,
      status,
      code,
    );
  }
  if (status === 409 && code === 'campaign_not_editable') {
    return new CampaignMailerError(
      'La campagne a ete lancee dans Campaign Mailer : elle ne prend plus de contacts.',
      false,
      status,
      code,
    );
  }
  if (status === 404) {
    return new CampaignMailerError(
      "La campagne n'existe plus dans Campaign Mailer.",
      false,
      status,
      code,
    );
  }
  if (status === 409 || status === 429 || status >= 500) {
    return new CampaignMailerError(
      `Campaign Mailer a repondu ${String(status)}, nouvel essai plus tard.`,
      true,
      status,
      code,
    );
  }
  // 400 ou 422 : la requete elle-meme est fautive, la retenter ne changera rien.
  return new CampaignMailerError(
    `Campaign Mailer a refuse le lot (${String(status)}${code === undefined ? '' : `, ${code}`}).`,
    false,
    status,
    code,
  );
}

export interface CampaignMailerClient {
  createDraft(
    name: string,
    contacts: readonly CampaignMailerContact[],
    idempotencyKey: string,
  ): Promise<CampaignMailerReport>;
  addContacts(
    campaignId: string,
    contacts: readonly CampaignMailerContact[],
    idempotencyKey: string,
  ): Promise<CampaignMailerReport>;
}

export function createCampaignMailerClient(options: {
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs?: number;
}): CampaignMailerClient {
  async function appeler(chemin: string, corps: unknown, cle: string) {
    let reponse: Response;
    try {
      reponse = await fetch(`${options.baseUrl}/api/v1${chemin}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.token}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'idempotency-key': cle,
        },
        body: JSON.stringify(corps),
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
    } catch (error) {
      throw new CampaignMailerError(
        `Campaign Mailer injoignable : ${error instanceof Error ? error.message : 'erreur'}.`,
        true,
      );
    }
    const texte = await reponse.text();
    const json = (() => {
      try {
        return JSON.parse(texte) as unknown;
      } catch {
        return undefined;
      }
    })();
    if (!reponse.ok) {
      const code = (json as { code?: unknown } | undefined)?.code;
      throw erreurPour(reponse.status, typeof code === 'string' ? code : undefined);
    }
    const lu = reponseSchema.safeParse(json);
    if (!lu.success) {
      throw new CampaignMailerError('Reponse de Campaign Mailer illisible.', false, reponse.status);
    }
    return lu.data;
  }

  return {
    createDraft: (name, contacts, cle) => appeler('/campaigns', { name, contacts }, cle),
    addContacts: (id, contacts, cle) =>
      appeler(`/campaigns/${encodeURIComponent(id)}/contacts`, { contacts }, cle),
  };
}
