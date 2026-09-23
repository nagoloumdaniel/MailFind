import { createHash } from 'node:crypto';

/**
 * Lecture et ordonnancement des migrations. Volontairement pur : aucune
 * entree-sortie ici, donc les regles qui comptent, l'ordre, les trous et les
 * retours arriere manquants, se testent sans base de donnees.
 */

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly upFile: string;
  readonly downFile: string;
}

const FILENAME_PATTERN = /^(\d{4})_([a-z0-9_]+)\.(up|down)\.sql$/;

interface ParsedFilename {
  readonly version: number;
  readonly name: string;
  readonly direction: 'up' | 'down';
}

export function parseMigrationFilename(filename: string): ParsedFilename | undefined {
  const match = FILENAME_PATTERN.exec(filename);
  if (match === null) return undefined;

  const [, digits, name, direction] = match;
  if (digits === undefined || name === undefined || direction === undefined) return undefined;

  return {
    version: Number.parseInt(digits, 10),
    name,
    direction: direction === 'up' ? 'up' : 'down',
  };
}

/**
 * Apparie les fichiers montants et descendants, et refuse tout ce qui rendrait
 * l'historique ambigu. Une migration sans retour arriere est rejetee : c'est
 * une exigence du cahier des charges, pas une preference.
 */
export function collectMigrations(filenames: readonly string[]): Migration[] {
  const ups = new Map<number, ParsedFilename>();
  const downs = new Map<number, ParsedFilename>();

  for (const filename of filenames) {
    const parsed = parseMigrationFilename(filename);
    if (parsed === undefined) continue;

    const target = parsed.direction === 'up' ? ups : downs;
    const existing = target.get(parsed.version);
    if (existing !== undefined) {
      throw new Error(
        `Deux migrations portent le numero ${String(parsed.version).padStart(4, '0')} : ` +
          `${existing.name} et ${parsed.name}`,
      );
    }
    target.set(parsed.version, parsed);
  }

  const migrations = [...ups.values()]
    // Tri numerique et non alphabetique : sans cela, 0010 passerait avant 0009
    // le jour ou le format des numeros changerait.
    .sort((a, b) => a.version - b.version)
    .map((up) => {
      const down = downs.get(up.version);
      if (down === undefined) {
        throw new Error(`La migration ${up.name} n'a pas de retour arriere (.down.sql)`);
      }
      if (down.name !== up.name) {
        throw new Error(
          `La migration ${up.name} et son retour arriere ${down.name} ne portent pas le meme nom`,
        );
      }
      return {
        version: up.version,
        name: up.name,
        upFile: `${String(up.version).padStart(4, '0')}_${up.name}.up.sql`,
        downFile: `${String(up.version).padStart(4, '0')}_${up.name}.down.sql`,
      } satisfies Migration;
    });

  for (const [index, migration] of migrations.entries()) {
    if (migration.version !== index + 1) {
      throw new Error(
        `Numerotation discontinue : ${String(migration.version).padStart(4, '0')} arrive ` +
          `en position ${String(index + 1)}`,
      );
    }
  }

  return migrations;
}

/**
 * Empreinte du contenu applique. Elle sert a detecter qu'une migration deja
 * jouee a ete modifiee apres coup, ce qui ferait diverger deux bases qui se
 * croient identiques.
 */
export function checksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}
