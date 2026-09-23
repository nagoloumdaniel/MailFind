/**
 * Ramene n'importe quelle valeur levee a une Error.
 *
 * JavaScript autorise a lever n'importe quoi, et les bibliotheques a rappel ne
 * s'en privent pas. Passer par `String(valeur)` donnerait « [object Object] »
 * sur la moitie des cas : mieux vaut un message franc que ce bruit.
 */
export function toError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string' && value !== '') return new Error(value);
  return new Error(fallback);
}
