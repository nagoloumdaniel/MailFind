import { z } from 'zod';

/**
 * Ce que la page Contacts peut demander (F-1003, F-1011, F-1012), lu depuis
 * la chaine de requete. Tout ce qui sert a construire le SQL passe par une
 * liste fermee : un nom de colonne ne vient jamais de l'utilisateur.
 */

export const CONTACT_SORTS = [
  'company',
  'name',
  'address',
  'type',
  'status',
  'score',
  'origin',
  'created',
] as const;
export type ContactSort = (typeof CONTACT_SORTS)[number];

export const PAGE_SIZES = [25, 50, 100] as const;

export const EMAIL_STATUSES = [
  'valid',
  'accept_all',
  'risky',
  'unknown',
  'invalid',
  'disposable',
  'suppressed',
  'unverified',
] as const;
export const EMAIL_TYPES = [
  'recruitment',
  'hr',
  'generic',
  'sales',
  'press',
  'support',
  'personal',
  'unknown',
] as const;
export const EMAIL_ORIGINS = ['found', 'provider', 'deduced', 'imported', 'manual'] as const;

/** `?status=valid&status=risky` ou `?status=valid,risky` : les deux formes. */
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

export const contactQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(''),
  status: liste(EMAIL_STATUSES),
  type: liste(EMAIL_TYPES),
  origin: liste(EMAIL_ORIGINS),
  tag: z.string().trim().max(50).optional(),
  companyId: z.uuid().optional(),
  importId: z.uuid().optional(),
  sort: z.enum(CONTACT_SORTS).default('company'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((taille) => (PAGE_SIZES as readonly number[]).includes(taille))
    .default(25),
});

export type ContactQuery = z.infer<typeof contactQuerySchema>;

/** Echappe `%`, `_` et `\` : la recherche porte sur le texte tape, pas sur un motif. */
export function likePattern(texte: string): string {
  return `%${texte.replace(/[\\%_]/g, (caractere) => `\\${caractere}`)}%`;
}

/** L'expression SQL de chaque tri, choisie dans une liste fermee. */
export const SORT_EXPRESSIONS: Record<ContactSort, string> = {
  company: 'lower(c.name)',
  name: "lower(nullif(e.contact_name, ''))",
  address: 'e.normalized_address',
  // Les enumerations se trient dans leur ordre de declaration : recrutement
  // d'abord pour le type, valide d'abord pour le statut.
  type: 'e.type',
  status: 'e.status',
  score: 'e.score',
  origin: 'e.origin',
  created: 'e.created_at',
};
