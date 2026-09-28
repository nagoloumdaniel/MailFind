import { z } from 'zod';

/**
 * Recherche web derriere une interface (D-07) : changer de fournisseur ne
 * touche que l'adaptateur. Aucun moteur n'est jamais interroge autrement que
 * par son API officielle, et aucune page de resultats n'est lue (F-305).
 */

export interface WebResult {
  readonly url: string;
  readonly title: string;
  readonly description: string;
}

export interface WebSearchProvider {
  readonly name: string;
  search(query: string): Promise<WebResult[]>;
}

const braveSchema = z.object({
  web: z
    .object({
      results: z.array(
        z.object({
          url: z.string(),
          title: z.string().default(''),
          description: z.string().default(''),
        }),
      ),
    })
    .optional(),
});

export class WebSearchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'WebSearchError';
  }
}

/** Brave Search API, formule Search (D-07). */
export function createBraveSearch(options: {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs?: number;
}): WebSearchProvider {
  return {
    name: 'brave',
    async search(query) {
      const url = new URL('/res/v1/web/search', options.baseUrl);
      url.searchParams.set('q', query);
      url.searchParams.set('country', 'fr');
      url.searchParams.set('search_lang', 'fr');
      url.searchParams.set('count', '10');
      url.searchParams.set('safesearch', 'strict');

      const reponse = await fetch(url, {
        headers: {
          accept: 'application/json',
          'x-subscription-token': options.apiKey,
        },
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
      if (!reponse.ok) {
        throw new WebSearchError(`Brave a repondu ${String(reponse.status)}`, reponse.status);
      }
      const lu = braveSchema.safeParse(await reponse.json());
      if (!lu.success) return [];
      return lu.data.web?.results ?? [];
    },
  };
}
