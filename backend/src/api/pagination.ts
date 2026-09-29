import { z } from 'zod';
import { AppError } from '../http/problem.js';

/**
 * Pagination par curseur de l'API publique (F-1307).
 *
 * Un curseur plutot qu'un numero de page : une liste qui grandit pendant
 * qu'on la parcourt ne fait ni sauter ni repeter une ligne. Le curseur est
 * opaque pour le client (base64url d'un petit JSON) ; il porte la cle de tri
 * de la derniere ligne rendue, la date de creation puis l'identifiant, qui
 * departage deux lignes creees dans la meme milliseconde.
 */

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export interface Cursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface PageParams {
  readonly limit: number;
  readonly cursor: Cursor | undefined;
}

const curseurSchema = z.object({
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});

const parametresSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().max(500).optional(),
});

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ createdAt: cursor.createdAt, id: cursor.id })).toString(
    'base64url',
  );
}

function decodeCursor(brut: string): Cursor {
  try {
    const lu = curseurSchema.safeParse(JSON.parse(Buffer.from(brut, 'base64url').toString('utf8')));
    if (lu.success) return lu.data;
  } catch {
    // Illisible : meme reponse qu'un curseur mal forme.
  }
  throw AppError.badRequest(
    'invalid_cursor',
    'Curseur refuse',
    "Reprenez le curseur tel que la page precedente l'a rendu.",
  );
}

export function parsePageParams(query: unknown): PageParams {
  const lu = parametresSchema.safeParse(query);
  if (!lu.success) {
    throw AppError.badRequest(
      'invalid_limit',
      'Parametres de pagination refuses',
      `limit va de 1 a ${String(MAX_LIMIT)}.`,
    );
  }
  return {
    limit: lu.data.limit,
    cursor: lu.data.cursor === undefined ? undefined : decodeCursor(lu.data.cursor),
  };
}

/**
 * Le tri et la condition de reprise, en SQL, sur la date tronquee a la
 * milliseconde : PostgreSQL garde la microseconde, JavaScript non. Comparee
 * telle quelle, la derniere ligne d'une page (…,123456) resterait plus grande
 * que son propre curseur (…,123) et reviendrait en tete de la suivante.
 *
 * `alias` est celui de la table ; `at` et `id` les numeros des parametres qui
 * portent le curseur (nuls sur la premiere page).
 */
export function cursorOrder(alias: string): string {
  return `date_trunc('milliseconds', ${alias}.created_at), ${alias}.id`;
}

export function cursorCondition(alias: string, at: number, id: number): string {
  return `($${String(at)}::timestamptz is null
          or (date_trunc('milliseconds', ${alias}.created_at), ${alias}.id)
             > ($${String(at)}::timestamptz, $${String(id)}::uuid))`;
}

export interface Page<T> {
  readonly data: T[];
  readonly next_cursor: string | null;
}

/**
 * A partir de `limit + 1` lignes lues, triees par date puis identifiant :
 * la ligne en trop dit seulement qu'il y a une suite, sans requete de
 * comptage.
 */
export function toPage<T>(
  rows: readonly T[],
  limit: number,
  keyOf: (row: T) => { createdAt: Date; id: string },
): Page<T> {
  const data = rows.slice(0, limit);
  const derniere = data.at(-1);
  if (rows.length <= limit || derniere === undefined) return { data, next_cursor: null };
  const cle = keyOf(derniere);
  return {
    data,
    next_cursor: encodeCursor({ createdAt: cle.createdAt.toISOString(), id: cle.id }),
  };
}
