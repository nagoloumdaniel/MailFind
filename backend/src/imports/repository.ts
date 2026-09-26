import { getPool, query } from '../db/pool.js';

export interface PreparedRow {
  readonly line: number;
  readonly raw: Record<string, string>;
  readonly status: 'accepted' | 'rejected';
  readonly error: string | undefined;
}

export interface ImportSummary {
  readonly id: string;
  readonly filename: string;
  readonly status: string;
  readonly totalRows: number;
  readonly processedRows: number;
  /** Lignes exploitables, qu'elles aient cree une entreprise ou rejoint une deja connue. */
  readonly acceptedRows: number;
  /** Parmi elles, celles qui ont rejoint une entreprise deja connue (F-303). */
  readonly duplicateRows: number;
  readonly rejectedRows: number;
  /** Motif lisible d'un import en echec, sinon nul. */
  readonly error: string | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

/**
 * Un seul ordre par tranche plutot qu'un par ligne : cinq mille allers-retours
 * pour un import de cinq mille lignes rendraient l'appel inutilisable. La
 * tranche reste sous la limite de parametres d'une requete PostgreSQL.
 */
const ROWS_PER_STATEMENT = 500;

export async function createImport(input: {
  userId: string;
  filename: string;
  settings: Record<string, unknown>;
  rows: readonly PreparedRow[];
}): Promise<ImportSummary> {
  const client = await getPool().connect();

  try {
    await client.query('begin');

    const created = await client.query<{ id: string; created_at: Date }>(
      `insert into imports (user_id, filename, settings, total_rows, status)
       values ($1, $2, $3, $4, 'pending')
       returning id, created_at`,
      [input.userId, input.filename, JSON.stringify(input.settings), input.rows.length],
    );

    const importe = created.rows[0];
    if (importe === undefined) throw new Error("L'import n'a pas ete cree.");

    for (let debut = 0; debut < input.rows.length; debut += ROWS_PER_STATEMENT) {
      const tranche = input.rows.slice(debut, debut + ROWS_PER_STATEMENT);
      const valeurs: unknown[] = [];
      const morceaux: string[] = [];

      tranche.forEach((ligne, index) => {
        const base = index * 5;
        morceaux.push(
          `($${String(base + 1)}, $${String(base + 2)}, $${String(base + 3)}, $${String(base + 4)}, $${String(base + 5)})`,
        );
        valeurs.push(
          importe.id,
          ligne.line,
          JSON.stringify(ligne.raw),
          ligne.status,
          ligne.error ?? null,
        );
      });

      await client.query(
        `insert into import_rows (import_id, line, raw, status, error) values ${morceaux.join(', ')}`,
        valeurs,
      );
    }

    await client.query('commit');

    const acceptees = input.rows.filter((ligne) => ligne.status === 'accepted').length;

    return {
      id: importe.id,
      filename: input.filename,
      status: 'pending',
      totalRows: input.rows.length,
      processedRows: 0,
      acceptedRows: acceptees,
      duplicateRows: 0,
      rejectedRows: input.rows.length - acceptees,
      error: null,
      createdAt: importe.created_at,
      completedAt: null,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

interface SummaryRow {
  id: string;
  filename: string;
  status: string;
  total_rows: number;
  processed_rows: number;
  accepted_rows: number;
  duplicate_rows: number;
  rejected_rows: number;
  error: string | null;
  created_at: Date;
  completed_at: Date | null;
}

function toSummary(row: SummaryRow): ImportSummary {
  return {
    id: row.id,
    filename: row.filename,
    status: row.status,
    totalRows: row.total_rows,
    processedRows: row.processed_rows,
    acceptedRows: row.accepted_rows,
    duplicateRows: row.duplicate_rows,
    rejectedRows: row.rejected_rows,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

/**
 * L'appartenance est verifiee dans la requete elle-meme, jamais apres coup
 * (S-04) : un import d'un autre compte n'existe pas, il ne se voit pas refuser.
 */
const SUMMARY_SELECT = `
  select i.id, i.filename, i.status::text as status, i.total_rows, i.processed_rows,
         i.error, i.created_at, i.completed_at,
         -- Un doublon est une ligne acceptee qui a rejoint une entreprise deja
         -- connue : le compter a part des acceptees ferait fondre ce chiffre a
         -- mesure que la planification avance.
         count(r.id) filter (where r.status in ('accepted', 'duplicate'))::int as accepted_rows,
         count(r.id) filter (where r.status = 'duplicate')::int as duplicate_rows,
         count(r.id) filter (where r.status = 'rejected')::int as rejected_rows
    from imports i
    left join import_rows r on r.import_id = i.id
   where i.user_id = $1`;

export async function listImports(userId: string, limit = 50): Promise<ImportSummary[]> {
  const result = await query<SummaryRow>(
    `${SUMMARY_SELECT}
     group by i.id
     order by i.created_at desc
     limit $2`,
    [userId, limit],
  );
  return result.rows.map(toSummary);
}

export async function findImport(
  userId: string,
  importId: string,
): Promise<ImportSummary | undefined> {
  const result = await query<SummaryRow>(`${SUMMARY_SELECT} and i.id = $2 group by i.id`, [
    userId,
    importId,
  ]);
  const row = result.rows[0];
  return row === undefined ? undefined : toSummary(row);
}

export interface RejectedRow {
  readonly line: number;
  readonly error: string;
}

/** Les lignes ecartees, pour que l'utilisateur sache lesquelles et pourquoi. */
export async function listRejectedRows(
  userId: string,
  importId: string,
  limit = 200,
): Promise<RejectedRow[]> {
  const result = await query<{ line: number; error: string | null }>(
    `select r.line, r.error
       from import_rows r
       join imports i on i.id = r.import_id
      where i.user_id = $1 and r.import_id = $2 and r.status = 'rejected'
      order by r.line
      limit $3`,
    [userId, importId, limit],
  );

  return result.rows.map((row) => ({ line: row.line, error: row.error ?? 'Ligne inexploitable.' }));
}
