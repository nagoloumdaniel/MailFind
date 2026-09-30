import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { z } from 'zod';
import { getEnvironment } from '../config/env.js';

/**
 * Ce que les deux applications se passent a la connexion croisee (D-26) :
 * l'identifiant Google, le meme pour une personne quel que soit le client
 * OAuth, et l'adresse. Rien d'autre, et surtout aucun jeton Google.
 */
export const ssoIdentitySchema = z.object({
  google_id: z.string().min(1).max(255),
  email: z.email().max(320),
  name: z.string().max(200).nullable().optional(),
});
export type SsoIdentity = z.infer<typeof ssoIdentitySchema>;

/** Un jeton d'etat tel que les deux applications en fabriquent. */
export const STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** Cookie qui garde la demande de Campaign Mailer le temps d'une connexion Google. */
export const PENDING_COOKIE = 'mailfind.sso';

export interface SsoConfig {
  /** L'adresse de Campaign Mailer, sans barre finale. */
  readonly partnerUrl: string;
  readonly secret: string;
}

/** La configuration, ou rien quand la connexion croisee est desactivee. */
export function ssoConfig(): SsoConfig | undefined {
  const environment = getEnvironment();
  const partnerUrl = environment.CAMPAIGN_MAILER_API_URL.replace(/\/+$/, '');
  const secret = environment.CAMPAIGN_MAILER_SSO_SECRET;
  return partnerUrl === '' || secret === '' ? undefined : { partnerUrl, secret };
}

/** Compare en temps constant, sur des empreintes pour egaliser les longueurs. */
export function secretMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Lit un cookie sans dependance de plus : un seul, au format simple. */
export function readCookie(req: Request, name: string): string | undefined {
  const entete = req.headers.cookie;
  if (entete === undefined) return undefined;
  for (const morceau of entete.split(';')) {
    const [cle, ...reste] = morceau.trim().split('=');
    if (cle === name) return decodeURIComponent(reste.join('='));
  }
  return undefined;
}

export type SsoExchange = (code: string) => Promise<SsoIdentity>;

/**
 * Echange un code emis par Campaign Mailer contre l'identite du compte. L'URL
 * vient de la configuration de l'exploitant, jamais d'un utilisateur ; aucune
 * redirection n'est suivie, et l'appel ne peut pas pendre.
 */
export function createSsoExchange(config: SsoConfig): SsoExchange {
  return async (code) => {
    const reponse = await fetch(`${config.partnerUrl}/api/sso/token`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.secret}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ code }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!reponse.ok) {
      throw new Error(`Campaign Mailer a refuse le code (${String(reponse.status)}).`);
    }
    return ssoIdentitySchema.parse(await reponse.json());
  };
}
