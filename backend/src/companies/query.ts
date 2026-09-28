import { z } from 'zod';
import { EMAIL_TYPES, PAGE_SIZES } from '../contacts/query.js';

/**
 * Ce que la vue Entreprises peut demander (F-1002). Comme pour les contacts,
 * tout ce qui devient du SQL passe par une liste fermee.
 */

export const COMPANY_SORTS = ['name', 'domain', 'city', 'emails', 'score', 'created'] as const;
export type CompanySort = (typeof COMPANY_SORTS)[number];

export const CRAWL_STATUSES = ['pending', 'running', 'done', 'failed', 'skipped'] as const;

function liste<T extends string>(valeurs: readonly [T, ...T[]]) {
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((brut) => {
      const morceaux = (Array.isArray(brut) ? brut : brut === undefined ? [] : [brut])
        .flatMap((valeur) => valeur.split(','))
        .map((valeur) => valeur.trim())
        .filter((valeur) => valeur !== '');
      return [...new Set(morceaux)];
    })
    .pipe(z.array(z.enum(valeurs)));
}

const facette = z.string().trim().max(200).optional();

export const companyQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(''),
  city: facette,
  country: facette,
  industry: facette,
  tag: z.string().trim().max(50).optional(),
  crawlStatus: liste(CRAWL_STATUSES),
  /** Entreprises qui ont au moins une adresse de chacun de ces types. */
  hasType: liste(EMAIL_TYPES),
  sort: z.enum(COMPANY_SORTS).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((taille) => (PAGE_SIZES as readonly number[]).includes(taille))
    .default(25),
});

export type CompanyQuery = z.infer<typeof companyQuerySchema>;

export const COMPANY_SORT_EXPRESSIONS: Record<CompanySort, string> = {
  name: 'lower(c.name)',
  domain: 'c.domain',
  city: "lower(nullif(c.city, ''))",
  emails: 'coalesce(a.total, 0)',
  score: 'a.best_score',
  created: 'c.created_at',
};
