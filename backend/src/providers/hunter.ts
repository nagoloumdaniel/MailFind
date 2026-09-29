import { z } from 'zod';
import {
  ProviderError,
  type DomainSearchResult,
  type EnrichmentProvider,
  type MailboxResult,
  type MailboxVerifier,
  type ProviderEmail,
} from './enrichment.js';

/**
 * Adaptateur Hunter, recherche par domaine (F-602, D-08).
 *
 * La cle passe dans un en-tete et jamais dans l'URL : une URL finit dans les
 * journaux, un en-tete non (S-03). La formule gratuite rend dix adresses par
 * recherche au plus, et une recherche coute un credit.
 */

const emailSchema = z.object({
  value: z.string(),
  type: z.enum(['personal', 'generic']).catch('generic'),
  confidence: z.number().nullish(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  position: z.string().nullish(),
  sources: z
    .array(z.object({ uri: z.string().nullish() }).passthrough())
    .nullish()
    .catch([]),
});

const reponseSchema = z.object({
  data: z.object({
    domain: z.string().nullish(),
    pattern: z.string().nullish(),
    emails: z.array(z.unknown()).catch([]),
  }),
});

/** Le code de reponse dit ce qu'on peut en conclure, et donc ce que le pipeline fait. */
function erreurPour(status: number): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError('Cle Hunter refusee', 'auth', status);
  }
  if (status === 429) {
    return new ProviderError('Hunter : quota ou debit depasse', 'quota', status);
  }
  if (status === 451) {
    return new ProviderError('Hunter ne traite pas ce domaine', 'refused', status);
  }
  if (status === 400 || status === 422) {
    return new ProviderError('Domaine refuse par Hunter', 'invalid', status);
  }
  return new ProviderError(`Hunter a repondu ${String(status)}`, 'unavailable', status);
}

function versAdresse(brut: unknown): ProviderEmail | undefined {
  const lu = emailSchema.safeParse(brut);
  if (!lu.success) return undefined;
  const email = lu.data;
  return {
    address: email.value,
    kind: email.type,
    ...(email.confidence === null || email.confidence === undefined
      ? {}
      : { confidence: email.confidence }),
    ...(email.first_name ? { firstName: email.first_name } : {}),
    ...(email.last_name ? { lastName: email.last_name } : {}),
    ...(email.position ? { position: email.position } : {}),
    sourceUrls: (email.sources ?? [])
      .map((source) => source.uri)
      .filter((uri): uri is string => typeof uri === 'string' && uri !== ''),
  };
}

export function createHunter(options: {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs?: number;
}): EnrichmentProvider {
  return {
    name: 'hunter',
    async domainSearch(domain): Promise<DomainSearchResult> {
      const url = new URL('/v2/domain-search', options.baseUrl);
      url.searchParams.set('domain', domain);
      url.searchParams.set('limit', '10');

      let reponse: Response;
      try {
        reponse = await fetch(url, {
          headers: { accept: 'application/json', 'x-api-key': options.apiKey },
          signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
        });
      } catch (error) {
        throw new ProviderError(
          `Hunter injoignable : ${error instanceof Error ? error.message : 'erreur'}`,
          'unavailable',
        );
      }
      if (!reponse.ok) throw erreurPour(reponse.status);

      const lu = reponseSchema.safeParse(await reponse.json().catch(() => undefined));
      if (!lu.success) {
        throw new ProviderError('Reponse de Hunter illisible', 'unavailable', reponse.status);
      }
      const { data } = lu.data;
      return {
        domain: data.domain ?? domain,
        ...(data.pattern ? { pattern: data.pattern } : {}),
        emails: data.emails
          .map(versAdresse)
          .filter((email): email is ProviderEmail => email !== undefined),
      };
    },
  };
}

const verificationSchema = z.object({
  data: z.object({
    status: z
      .enum(['valid', 'invalid', 'accept_all', 'unknown', 'disposable', 'webmail'])
      .catch('unknown'),
    result: z.string().nullish(),
    score: z.number().nullish(),
  }),
});

/**
 * Verification de boite par Hunter (niveau 8 de 6.7, D-08). Une verification
 * coute un demi-credit. Hunter repond 202 quand le serveur de messagerie
 * tarde : ce n'est pas un verdict, et l'etape le traite comme une
 * indisponibilite, sans rien conclure.
 */
export function createHunterVerifier(options: {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs?: number;
}): MailboxVerifier {
  return {
    name: 'hunter',
    async verify(address): Promise<MailboxResult> {
      const url = new URL('/v2/email-verifier', options.baseUrl);
      url.searchParams.set('email', address);

      let reponse: Response;
      try {
        reponse = await fetch(url, {
          headers: { accept: 'application/json', 'x-api-key': options.apiKey },
          signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
        });
      } catch (error) {
        throw new ProviderError(
          `Hunter injoignable : ${error instanceof Error ? error.message : 'erreur'}`,
          'unavailable',
        );
      }
      if (reponse.status === 202) {
        throw new ProviderError('Verification encore en cours chez Hunter', 'unavailable', 202);
      }
      if (!reponse.ok) throw erreurPour(reponse.status);

      const lu = verificationSchema.safeParse(await reponse.json().catch(() => undefined));
      if (!lu.success) {
        throw new ProviderError('Reponse de Hunter illisible', 'unavailable', reponse.status);
      }
      const { status, result, score } = lu.data.data;
      return {
        status,
        ...(result ? { subStatus: result } : {}),
        ...(score === null || score === undefined ? {} : { providerScore: score }),
      };
    },
  };
}
