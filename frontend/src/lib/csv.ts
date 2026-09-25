import Papa from 'papaparse';

/**
 * Lecture d'un fichier d'import, entierement dans le navigateur.
 *
 * Le fichier ne part sur le serveur qu'une fois la correspondance des colonnes
 * validee : l'utilisateur doit pouvoir se tromper de fichier, voir ce qu'il a
 * depose, et faire demi tour, sans que rien ne soit televerse.
 */

/** F-201 : 5 000 lignes et 5 Mo au plus. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5000;

/** Les seuls separateurs a deviner (etape 1 du parcours). */
const DELIMITERS = [',', ';', '\t'];

export type Encoding = 'utf-8' | 'windows-1252';

export interface ParsedCsv {
  readonly encoding: Encoding;
  readonly delimiter: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export type CsvProblemCode =
  'file_too_large' | 'file_empty' | 'no_header' | 'no_rows' | 'too_many_rows' | 'unreadable';

export interface CsvProblem {
  readonly code: CsvProblemCode;
  /** Message affichable, qui dit quoi faire et non seulement ce qui cloche. */
  readonly message: string;
}

export type CsvResult = { ok: true; data: ParsedCsv } | { ok: false; problem: CsvProblem };

function refus(code: CsvProblemCode, message: string): CsvResult {
  return { ok: false, problem: { code, message } };
}

/**
 * Decode les octets du fichier.
 *
 * On tente d'abord l'UTF-8 en mode strict : s'il passe, c'est de l'UTF-8, la
 * question est reglee. S'il echoue, le fichier vient presque toujours d'un
 * tableur Windows, et Windows-1252 le lira sans perdre les accents. Deviner
 * dans l'autre sens serait pire : Windows-1252 accepte n'importe quelle suite
 * d'octets, donc ne signale jamais son erreur, et rendrait un texte plein de
 * caracteres faux sans prevenir.
 */
export function decodeCsv(buffer: ArrayBuffer): { text: string; encoding: Encoding } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return { text, encoding: 'utf-8' };
  } catch {
    return {
      text: new TextDecoder('windows-1252').decode(buffer),
      encoding: 'windows-1252',
    };
  }
}

function normaliseCell(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Analyse un texte deja decode. Separee du fichier pour rester testable. */
export function parseCsvText(text: string, encoding: Encoding = 'utf-8'): CsvResult {
  if (text.trim() === '') {
    return refus('file_empty', 'Ce fichier est vide.');
  }

  const parsed = Papa.parse<string[]>(text, {
    header: false,
    delimitersToGuess: DELIMITERS,
    // « greedy » ecarte aussi les lignes qui ne contiennent que des
    // separateurs, courantes en fin de fichier exporte depuis un tableur.
    skipEmptyLines: 'greedy',
  });

  const lignes = parsed.data.map((ligne) => ligne.map(normaliseCell));
  const entete = lignes[0];

  if (entete === undefined || entete.every((cellule) => cellule === '')) {
    return refus('no_header', 'La premiere ligne doit contenir les noms des colonnes.');
  }

  const corps = lignes.slice(1).filter((ligne) => ligne.some((cellule) => cellule !== ''));

  if (corps.length === 0) {
    return refus('no_rows', 'Ce fichier ne contient que son en-tete, aucune entreprise a traiter.');
  }

  if (corps.length > MAX_ROWS) {
    return refus(
      'too_many_rows',
      `Ce fichier contient ${corps.length.toLocaleString('fr-FR')} lignes. Le maximum est de ${MAX_ROWS.toLocaleString('fr-FR')} par import : coupez-le en plusieurs fichiers.`,
    );
  }

  return {
    ok: true,
    data: {
      encoding,
      delimiter: parsed.meta.delimiter,
      headers: entete,
      rows: corps,
    },
  };
}

/** Lit un fichier depose, du disque jusqu'aux lignes exploitables. */
export async function readCsvFile(file: File): Promise<CsvResult> {
  if (file.size === 0) {
    return refus('file_empty', 'Ce fichier est vide.');
  }

  if (file.size > MAX_FILE_BYTES) {
    const megaoctets = (file.size / 1024 / 1024).toFixed(1);
    return refus(
      'file_too_large',
      `Ce fichier pese ${megaoctets} Mo. Le maximum est de 5 Mo par import.`,
    );
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    return refus('unreadable', "Ce fichier n'a pas pu etre lu. Reessayez.");
  }

  const { text, encoding } = decodeCsv(buffer);
  return parseCsvText(text, encoding);
}
