import { gzipSync, gunzipSync } from 'node:zlib';
import { getPool, query } from '../db/pool.js';
import type { ExportStorage } from '../exports/storage.js';
import { getLogger } from '../observability/logger.js';

/**
 * Sauvegarde quotidienne et restauration (Phase 10).
 *
 * Neon garde un historique, mais six heures seulement sur le palier gratuit :
 * de quoi rattraper une fausse manoeuvre du matin, pas de quoi repondre a une
 * perte decouverte le lendemain. Il faut donc une sauvegarde a part, et
 * ailleurs : R2, le meme stockage que les exports.
 *
 * Le format est un NDJSON gzip, une ligne par enregistrement, precede d'un
 * en-tete. Pas un `pg_dump` : le binaire n'est pas dans l'image de
 * production, et un format que Node sait relire se restaure depuis n'importe
 * ou, y compris dans un test.
 *
 * Ce que la sauvegarde ne contient pas : rien. Elle porte les adresses, donc
 * des donnees personnelles, et vit sous les memes regles que la base.
 */

/**
 * Les tables sauvegardees.
 *
 * N'y sont pas, volontairement : `provider_cache` et `disposable_domains`,
 * qui se reconstruisent ; `idempotency_keys`, `sso_codes` et
 * `verification_runs`, qui expirent en heures ou en jours et n'ont aucun sens
 * restaures ; `provider_budget_alerts`, qui ne dit rien qu'un journal ne dise.
 *
 * Le test de la restauration echoue si une table de la base manque a cette
 * liste sans y etre nommee : une table ajoutee sans decision ne peut pas
 * passer inapercue.
 */
export const BACKED_UP_TABLES = [
  'users',
  'companies',
  'emails',
  'email_sources',
  'verifications',
  'imports',
  'import_rows',
  'pipeline_jobs',
  'suppressions',
  'erased_addresses',
  'excluded_domains',
  'exports',
  'api_keys',
  'webhooks',
  'webhook_deliveries',
  'campaign_mailer_connections',
  'campaign_mailer_pushes',
  'quota_usage',
  'provider_calls',
  'audit_events',
] as const;

export interface BackupHeader {
  readonly kind: 'mailfind-backup';
  readonly version: 1;
  readonly createdAt: string;
  readonly tables: readonly string[];
}

export interface BackupReport {
  readonly key: string;
  readonly bytes: number;
  readonly rows: Record<string, number>;
}

/** Les tables qui existent vraiment : une sauvegarde ne doit pas tomber sur une table a venir. */
async function tablesPresentes(): Promise<string[]> {
  const lues = await query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = current_schema() and table_type = 'BASE TABLE'`,
  );
  const connues = new Set(lues.rows.map((ligne) => ligne.table_name));
  return BACKED_UP_TABLES.filter((nom) => connues.has(nom));
}

/**
 * Produit la sauvegarde et la depose. Le nom porte la date : une par jour,
 * et celle d'hier reste lisible.
 */
export async function createBackup(
  storage: ExportStorage,
  maintenant = new Date(),
): Promise<BackupReport> {
  const tables = await tablesPresentes();
  const lignes: string[] = [];
  const compte: Record<string, number> = {};

  const entete: BackupHeader = {
    kind: 'mailfind-backup',
    version: 1,
    createdAt: maintenant.toISOString(),
    tables,
  };
  lignes.push(JSON.stringify(entete));

  for (const table of tables) {
    // `row_to_json` rend chaque ligne telle quelle, types compris : pas de
    // mappage a tenir a jour quand une colonne arrive.
    const contenu = await query<{ ligne: string }>(
      `select row_to_json(t)::text as ligne from ${table} t`,
    );
    compte[table] = contenu.rows.length;
    for (const { ligne } of contenu.rows) lignes.push(JSON.stringify({ table, ligne }));
  }

  const corps = gzipSync(Buffer.from(lignes.join('\n'), 'utf8'));
  const key = `backups/${maintenant.toISOString().slice(0, 10)}.ndjson.gz`;
  await storage.put(key, corps, 'application/gzip');

  getLogger().info({ key, octets: corps.byteLength, lignes: compte }, 'sauvegarde deposee');
  return { key, bytes: corps.byteLength, rows: compte };
}

export interface RestoreReport {
  readonly createdAt: string;
  readonly rows: Record<string, number>;
}

/**
 * Restaure une sauvegarde dans la base courante. **Elle efface ce qui s'y
 * trouve** : une restauration partielle melangerait deux etats, ce qui est
 * pire que les deux.
 *
 * Les contraintes sont desactivees le temps du chargement, dans la
 * transaction : sans cela il faudrait tenir a jour un ordre entre vingt
 * tables, et un ordre faux ne se verrait qu'un jour d'incident.
 */
export async function restoreBackup(archive: Buffer): Promise<RestoreReport> {
  const [premiere, ...reste] = gunzipSync(archive).toString('utf8').split('\n');
  const entete = JSON.parse(premiere ?? '{}') as BackupHeader;
  if (entete.kind !== 'mailfind-backup' || entete.version !== 1) {
    throw new Error("Ce fichier n'est pas une sauvegarde MailFind lisible par cette version.");
  }

  const client = await getPool().connect();
  const compte: Record<string, number> = {};
  try {
    await client.query('begin');
    await client.query("set local session_replication_role = 'replica'");

    const presentes = entete.tables;
    if (presentes.length > 0) {
      await client.query(`truncate ${presentes.join(', ')} restart identity cascade`);
    }

    for (const brut of reste) {
      if (brut === '') continue;
      const { table, ligne } = JSON.parse(brut) as { table: string; ligne: string };
      if (!presentes.includes(table)) continue;
      // `json_populate_record` reconstruit la ligne a partir de la forme de la
      // table : une colonne ajoutee depuis prend sa valeur par defaut.
      await client.query(
        `insert into ${table} select * from json_populate_record(null::${table}, $1::json)`,
        [ligne],
      );
      compte[table] = (compte[table] ?? 0) + 1;
    }

    await client.query('commit');
  } catch (erreur) {
    await client.query('rollback').catch(() => undefined);
    throw erreur;
  } finally {
    client.release();
  }

  getLogger().info({ lignes: compte, sauvegardeDu: entete.createdAt }, 'sauvegarde restauree');
  return { createdAt: entete.createdAt, rows: compte };
}

/** Les sauvegardes de plus de trente jours s'effacent : elles portent des adresses (R-06). */
export const BACKUP_RETENTION_DAYS = 30;

export function expiredBackupKeys(keys: readonly string[], maintenant = new Date()): string[] {
  const limite = new Date(maintenant.getTime() - BACKUP_RETENTION_DAYS * 24 * 3600 * 1000);
  return keys.filter((key) => {
    const jour = /^backups\/(\d{4}-\d{2}-\d{2})\.ndjson\.gz$/.exec(key)?.[1];
    return jour !== undefined && new Date(jour) < limite;
  });
}
